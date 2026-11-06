import { z } from 'zod';
import { db, withTransaction } from '../../db/knex';
import { todayIn } from '../../lib/dates';
import { conflict, notFound, unprocessable } from '../../lib/errors';
import { apiRouter, idParams, isoDate, optionalText, queryBool } from '../../lib/http';
import { allocate, dec, money, positiveMoney, storage, sum } from '../../lib/money';
import { audit } from '../audit/audit.service';
import { categoryBySlug } from '../categories/categories.service';
import { postTransaction } from '../transactions/ledger.service';

export const expenseSplits = apiRouter('/expenses', 'Expenses');

expenseSplits.post('/:id/splits', {
  summary: 'Split an expense with others (equal or exact shares); replaces unsettled shares',
  params: idParams,
  body: z.object({
    method: z.enum(['equal', 'exact']).default('equal'),
    includeSelf: z.boolean().default(true),
    participants: z
      .array(z.object({ name: z.string().trim().min(1).max(80), contact: optionalText(120), shareAmount: positiveMoney.optional() }))
      .min(1)
      .max(20),
  }),
  handler: async ({ user, params, body, req }) => {
    return withTransaction(async (trx) => {
      const expense = await trx('expense_records as e')
        .join('transactions as t', 't.id', 'e.transaction_id')
        .where({ 'e.id': params.id, 'e.user_id': user.id })
        .whereNull('e.deleted_at')
        .first('e.id', 't.amount');
      if (!expense) throw notFound('Expense');
      const settled = await trx('expense_splits').where({ expense_record_id: params.id, is_settled: true }).first('id');
      if (settled) throw conflict('Some shares are already settled; settle or keep the existing split');

      let shares: string[];
      if (body.method === 'equal') {
        const parts = allocate(expense.amount, body.participants.length + (body.includeSelf ? 1 : 0));
        // When you are included, you keep the first share (which absorbs rounding).
        shares = (body.includeSelf ? parts.slice(1) : parts).map((d) => storage(d));
      } else {
        if (body.participants.some((p) => !p.shareAmount)) throw unprocessable('Give every participant a share amount for exact splits');
        shares = body.participants.map((p) => storage(p.shareAmount!));
      }
      const othersTotal = sum(shares);
      if (othersTotal.gt(expense.amount)) throw unprocessable('Shares cannot exceed the expense amount');

      await trx('expense_splits').where({ expense_record_id: params.id }).delete();
      const rows = await trx('expense_splits')
        .insert(body.participants.map((p, i) => ({ user_id: user.id, expense_record_id: params.id, participant_name: p.name, participant_contact: p.contact ?? null, share_amount: shares[i] })))
        .returning('*');
      await trx('expense_records').where({ id: params.id }).update({ is_split: true });
      await audit({ action: 'expense.split', req, entityType: 'expense_record', entityId: params.id, metadata: { participants: rows.length } }, trx);
      return {
        expenseId: params.id,
        total: money(expense.amount),
        yourShare: money(dec(expense.amount).minus(othersTotal)),
        owedToYou: money(othersTotal),
        splits: rows.map((s) => ({ ...s, shareAmount: money(s.shareAmount) })),
      };
    });
  },
});

export const splits = apiRouter('/splits', 'Expenses');

splits.get('/', {
  summary: 'Money owed to you from split expenses, grouped by person',
  query: z.object({ settled: queryBool.optional() }),
  handler: async ({ user, query }) => {
    const q = db('expense_splits as s')
      .join('expense_records as e', 'e.id', 's.expense_record_id')
      .join('transactions as t', 't.id', 'e.transaction_id')
      .where('s.user_id', user.id)
      .whereNull('e.deleted_at')
      .select('s.*', 't.description as expense_description', 't.occurred_on as expense_date', 't.amount as expense_amount')
      .orderBy('t.occurred_on', 'desc');
    if (query.settled !== undefined) q.where('s.is_settled', query.settled);
    const rows: Array<Record<string, any>> = await q;
    const byPerson = new Map<string, { name: string; outstanding: string; count: number }>();
    for (const r of rows.filter((x) => !x.isSettled)) {
      const p = byPerson.get(r.participantName) ?? { name: r.participantName, outstanding: '0', count: 0 };
      byPerson.set(r.participantName, { name: r.participantName, outstanding: storage(dec(p.outstanding).plus(r.shareAmount)), count: p.count + 1 });
    }
    return {
      items: rows.map((r) => ({ ...r, shareAmount: money(r.shareAmount), expenseAmount: money(r.expenseAmount) })),
      byPerson: [...byPerson.values()].map((p) => ({ ...p, outstanding: money(p.outstanding) })),
      totalOutstanding: money(sum(rows.filter((x) => !x.isSettled).map((x) => x.shareAmount))),
    };
  },
});

splits.post('/:id/settle', {
  summary: 'Mark a share as repaid and record the money received',
  params: idParams,
  body: z.object({ accountId: z.uuid(), settledOn: isoDate.default(() => todayIn()), recordPayment: z.boolean().default(true) }),
  handler: async ({ user, params, body, req }) => {
    return withTransaction(async (trx) => {
      const split = await trx('expense_splits').where({ id: params.id, user_id: user.id }).forUpdate().first();
      if (!split) throw notFound('Split');
      if (split.isSettled) throw conflict('This share is already settled');
      let txnId: string | null = null;
      if (body.recordPayment) {
        const txn = await postTransaction(
          {
            userId: user.id,
            accountId: body.accountId,
            kind: 'refund',
            amount: split.shareAmount,
            occurredOn: body.settledOn,
            description: `Split settlement from ${split.participantName}`,
            counterparty: split.participantName,
            categoryId: await categoryBySlug('income.refunds', trx),
            autoCategorize: false,
            allowDuplicate: true,
          },
          trx,
        );
        txnId = txn.id;
      }
      const [row] = await trx('expense_splits')
        .where({ id: params.id })
        .update({ is_settled: true, settled_on: body.settledOn, settlement_transaction_id: txnId })
        .returning('*');
      await audit({ action: 'expense.split_settled', req, entityType: 'expense_split', entityId: params.id }, trx);
      return { ...row, shareAmount: money(row.shareAmount) };
    });
  },
});

splits.delete('/:id', {
  summary: 'Remove an unsettled share',
  params: idParams,
  handler: async ({ user, params }) => {
    const deleted = await db('expense_splits').where({ id: params.id, user_id: user.id, is_settled: false }).delete();
    if (!deleted) throw notFound('Unsettled split');
    return undefined;
  },
});
