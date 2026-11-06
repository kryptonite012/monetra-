import type { Request } from 'express';
import { db, withTransaction } from '../../db/knex';
import { dec, money, storage } from '../../lib/money';
import { findOwned } from '../../lib/ownership';
import { audit } from '../audit/audit.service';
import { postTransaction } from '../transactions/ledger.service';
import { balanceAsOf } from './accounts.service';

function previousDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Compares the balance printed on a bank statement with the balance Monetra
 * computes from the ledger. Optionally posts an explicit, auditable
 * adjustment entry for any difference (never edits history).
 */
export async function reconcile(
  userId: string,
  accountId: string,
  input: { asOfDate: string; statementBalance: string; postAdjustment: boolean; note?: string | null },
  req?: Request,
) {
  await findOwned('accounts', accountId, userId, 'Account');
  return withTransaction(async (trx) => {
    const computed = await balanceAsOf(accountId, input.asOfDate, trx);
    const difference = dec(input.statementBalance).minus(computed);
    let adjustmentId: string | null = null;
    if (!difference.isZero() && input.postAdjustment) {
      const adj = await postTransaction(
        {
          userId,
          accountId,
          kind: 'adjustment',
          direction: difference.isPositive() ? 'credit' : 'debit',
          amount: storage(difference.abs()),
          occurredOn: input.asOfDate,
          description: 'Reconciliation adjustment',
          notes: input.note ?? `Statement balance ${money(input.statementBalance)} vs computed ${money(computed)}`,
          source: 'system',
          autoCategorize: false,
          allowDuplicate: true,
        },
        trx,
      );
      adjustmentId = adj.id;
    }
    const reconciled = difference.isZero() || input.postAdjustment;
    const [row] = await trx('account_balances')
      .insert({
        user_id: userId,
        account_id: accountId,
        as_of_date: input.asOfDate,
        balance: storage(input.statementBalance),
        computed_balance: computed,
        difference: storage(difference),
        source: 'statement',
        reconciled,
        adjustment_transaction_id: adjustmentId,
        note: input.note ?? null,
      })
      .onConflict(['account_id', 'as_of_date', 'source'])
      .merge()
      .returning('*');
    await audit({ action: 'account.reconciled', userId, req, entityType: 'account', entityId: accountId, metadata: { asOfDate: input.asOfDate, difference: storage(difference), adjustmentId } }, trx);
    return {
      ...row,
      balance: money(row.balance),
      computedBalance: money(row.computedBalance),
      difference: money(row.difference),
      status: difference.isZero() ? 'matched' : input.postAdjustment ? 'adjusted' : 'mismatch',
    };
  });
}

/** Account statement with opening/closing balance and a running balance per entry. */
export async function accountStatement(userId: string, accountId: string, from: string, to: string) {
  const account = await findOwned('accounts', accountId, userId, 'Account');
  const opening = await balanceAsOf(accountId, previousDay(from));
  const { rows } = await db.raw(
    `SELECT t.id, t.occurred_on, t.posted_at, t.description, t.reference, t.counterparty, t.kind, t.status,
            t.direction, t.amount, c.name AS category_name,
            ?::numeric + SUM(CASE WHEN t.direction = 'credit' THEN t.amount ELSE -t.amount END)
              OVER (ORDER BY t.occurred_on, t.posted_at, t.id) AS running_balance
       FROM transactions t
       LEFT JOIN transaction_categories c ON c.id = t.category_id
      WHERE t.account_id = ? AND t.occurred_on BETWEEN ? AND ?
      ORDER BY t.occurred_on, t.posted_at, t.id`,
    [opening, accountId, from, to],
  );
  const credits = rows.filter((r: any) => r.direction === 'credit').reduce((s: any, r: any) => s.plus(r.amount), dec(0));
  const debits = rows.filter((r: any) => r.direction === 'debit').reduce((s: any, r: any) => s.plus(r.amount), dec(0));
  return {
    account: { id: account.id, name: account.name, type: account.type, institutionName: account.institutionName, accountNumberLast4: account.accountNumberLast4, currency: account.currency },
    period: { from, to },
    openingBalance: money(opening),
    totalCredits: money(credits),
    totalDebits: money(debits),
    closingBalance: money(dec(opening).plus(credits).minus(debits)),
    entries: rows.map((r: any) => ({ ...r, amount: money(r.amount), runningBalance: money(r.runningBalance) })),
  };
}
