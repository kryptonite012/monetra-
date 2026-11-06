import type { Knex } from 'knex';
import { db, withTransaction } from '../../db/knex';
import { notFound, unprocessable } from '../../lib/errors';
import { dec, money, storage, sum } from '../../lib/money';
import { categoryBySlug } from '../categories/categories.service';
import { postTransaction, reverseTransaction } from '../transactions/ledger.service';

export const INCOME_SOURCES = [
  'salary', 'business', 'freelance', 'rental', 'interest', 'dividend', 'capital_gains', 'pension', 'bonus', 'gift', 'refund', 'other',
] as const;
export type IncomeSource = (typeof INCOME_SOURCES)[number];

const SOURCE_CATEGORY: Record<IncomeSource, string> = {
  salary: 'income.salary',
  bonus: 'income.salary',
  business: 'income.business',
  freelance: 'income.freelance',
  rental: 'income.rental',
  interest: 'income.interest',
  dividend: 'income.dividends',
  capital_gains: 'income.capital_gains',
  pension: 'income.other',
  gift: 'income.gifts',
  refund: 'income.refunds',
  other: 'income.other',
};

export interface IncomeInput {
  accountId: string;
  sourceType: IncomeSource;
  grossAmount: string;
  taxDeducted?: string;
  otherDeductions?: string;
  occurredOn: string;
  payerName?: string | null;
  description?: string | null;
  categoryId?: string | null;
  periodMonth?: string | null;
  isTaxable?: boolean;
  paymentMethodId?: string | null;
  reference?: string | null;
  notes?: string | null;
  recurringRuleId?: string | null;
  source?: 'manual' | 'recurring';
}

function computeNet(input: IncomeInput) {
  const tax = dec(input.taxDeducted ?? 0);
  const other = dec(input.otherDeductions ?? 0);
  const net = dec(input.grossAmount).minus(tax).minus(other);
  if (!net.gt(0)) throw unprocessable('Deductions cannot exceed the gross amount', { field: 'taxDeducted' });
  return { tax: storage(tax), other: storage(other), net: storage(net) };
}

async function postIncomeEntry(userId: string, input: IncomeInput, net: string, trx: Knex.Transaction, supersedesId?: string) {
  const categoryId = input.categoryId ?? (await categoryBySlug(SOURCE_CATEGORY[input.sourceType], trx));
  const label = input.sourceType.replace('_', ' ');
  return postTransaction(
    {
      userId,
      accountId: input.accountId,
      kind: 'income',
      amount: net,
      occurredOn: input.occurredOn,
      description: input.description?.trim() || `${label[0].toUpperCase()}${label.slice(1)}${input.payerName ? ` from ${input.payerName}` : ''}`,
      categoryId,
      paymentMethodId: input.paymentMethodId,
      reference: input.reference,
      counterparty: input.payerName,
      notes: input.notes,
      source: input.source ?? 'manual',
      supersedesId,
      allowDuplicate: Boolean(supersedesId),
      autoCategorize: false,
    },
    trx,
  );
}

export async function createIncome(userId: string, input: IncomeInput, conn?: Knex.Transaction) {
  const run = async (trx: Knex.Transaction) => {
    const { tax, other, net } = computeNet(input);
    const txn = await postIncomeEntry(userId, input, net, trx);
    const [record] = await trx('income_records')
      .insert({
        user_id: userId,
        transaction_id: txn.id,
        source_type: input.sourceType,
        payer_name: input.payerName ?? null,
        gross_amount: storage(input.grossAmount),
        tax_deducted: tax,
        other_deductions: other,
        net_amount: net,
        period_month: input.periodMonth ? `${input.periodMonth}-01` : null,
        is_taxable: input.isTaxable ?? input.sourceType !== 'gift',
        recurring_rule_id: input.recurringRuleId ?? null,
        notes: input.notes ?? null,
      })
      .returning('*');
    return { record, warnings: txn.warnings };
  };
  return conn ? run(conn) : withTransaction(run);
}

/** Corrects an income record: the old ledger entry is reversed and a replacement posted. */
export async function updateIncome(userId: string, id: string, patch: Partial<IncomeInput>, reason: string) {
  return withTransaction(async (trx) => {
    const record = await trx('income_records').where({ id, user_id: userId }).whereNull('deleted_at').forUpdate().first();
    if (!record) throw notFound('Income record');
    const txn = await trx('transactions').where({ id: record.transactionId }).first();
    const merged: IncomeInput = {
      accountId: patch.accountId ?? txn.accountId,
      sourceType: patch.sourceType ?? record.sourceType,
      grossAmount: patch.grossAmount ?? record.grossAmount,
      taxDeducted: patch.taxDeducted ?? record.taxDeducted,
      otherDeductions: patch.otherDeductions ?? record.otherDeductions,
      occurredOn: patch.occurredOn ?? txn.occurredOn,
      payerName: patch.payerName !== undefined ? patch.payerName : record.payerName,
      description: patch.description ?? txn.description,
      categoryId: patch.categoryId !== undefined ? patch.categoryId : txn.categoryId,
      periodMonth: patch.periodMonth !== undefined ? patch.periodMonth : record.periodMonth?.slice(0, 7),
      isTaxable: patch.isTaxable ?? record.isTaxable,
      paymentMethodId: patch.paymentMethodId !== undefined ? patch.paymentMethodId : txn.paymentMethodId,
      reference: patch.reference !== undefined ? patch.reference : txn.reference,
      notes: patch.notes !== undefined ? patch.notes : record.notes,
    };
    const { tax, other, net } = computeNet(merged);
    await reverseTransaction(userId, txn.id, reason, trx);
    const replacement = await postIncomeEntry(userId, merged, net, trx, txn.id);
    const [updated] = await trx('income_records')
      .where({ id })
      .update({
        transaction_id: replacement.id,
        source_type: merged.sourceType,
        payer_name: merged.payerName ?? null,
        gross_amount: storage(merged.grossAmount),
        tax_deducted: tax,
        other_deductions: other,
        net_amount: net,
        period_month: merged.periodMonth ? `${merged.periodMonth.slice(0, 7)}-01` : null,
        is_taxable: merged.isTaxable,
        notes: merged.notes ?? null,
      })
      .returning('*');
    return updated;
  });
}

export async function deleteIncome(userId: string, id: string, reason: string) {
  return withTransaction(async (trx) => {
    const record = await trx('income_records').where({ id, user_id: userId }).whereNull('deleted_at').forUpdate().first();
    if (!record) throw notFound('Income record');
    await reverseTransaction(userId, record.transactionId, reason, trx);
    await trx('income_records').where({ id }).update({ deleted_at: trx.fn.now() });
  });
}

export function incomeQuery(userId: string) {
  return db('income_records as i')
    .join('transactions as t', 't.id', 'i.transaction_id')
    .join('accounts as a', 'a.id', 't.account_id')
    .leftJoin('transaction_categories as c', 'c.id', 't.category_id')
    .where('i.user_id', userId)
    .whereNull('i.deleted_at')
    .select(
      'i.*',
      't.occurred_on',
      't.description',
      't.account_id',
      't.reference',
      't.payment_method_id',
      'a.name as account_name',
      't.category_id',
      'c.name as category_name',
    );
}

/** Monthly and per-source income breakdown for a date range. */
export async function incomeSummary(userId: string, from: string, to: string) {
  const rows: Array<Record<string, any>> = await db('income_records as i')
    .join('transactions as t', 't.id', 'i.transaction_id')
    .where('i.user_id', userId)
    .whereNull('i.deleted_at')
    .whereBetween('t.occurred_on', [from, to])
    .groupByRaw(`to_char(t.occurred_on, 'YYYY-MM'), i.source_type`)
    .select(
      db.raw(`to_char(t.occurred_on, 'YYYY-MM') AS month`),
      'i.source_type',
      db.raw('SUM(i.gross_amount) AS gross'),
      db.raw('SUM(i.tax_deducted) AS tax'),
      db.raw('SUM(i.net_amount) AS net'),
      db.raw('COUNT(*)::int AS count'),
    )
    .orderBy('month');

  const byMonth = new Map<string, { month: string; gross: string; tax: string; net: string }>();
  const bySource = new Map<string, { sourceType: string; gross: string; tax: string; net: string; count: number }>();
  for (const r of rows) {
    const m = byMonth.get(r.month) ?? { month: r.month, gross: '0', tax: '0', net: '0' };
    byMonth.set(r.month, { month: r.month, gross: storage(dec(m.gross).plus(r.gross)), tax: storage(dec(m.tax).plus(r.tax)), net: storage(dec(m.net).plus(r.net)) });
    const s = bySource.get(r.sourceType) ?? { sourceType: r.sourceType, gross: '0', tax: '0', net: '0', count: 0 };
    bySource.set(r.sourceType, { sourceType: r.sourceType, gross: storage(dec(s.gross).plus(r.gross)), tax: storage(dec(s.tax).plus(r.tax)), net: storage(dec(s.net).plus(r.net)), count: s.count + r.count });
  }
  const months = [...byMonth.values()];
  const totalNet = sum(months.map((m) => m.net));
  const sources = [...bySource.values()].sort((a, b) => dec(b.net).cmp(a.net));
  return {
    period: { from, to },
    totals: {
      gross: money(sum(months.map((m) => m.gross))),
      taxDeducted: money(sum(months.map((m) => m.tax))),
      net: money(totalNet),
      averageMonthlyNet: money(months.length ? totalNet.div(months.length) : 0),
    },
    byMonth: months.map((m) => ({ month: m.month, gross: money(m.gross), taxDeducted: money(m.tax), net: money(m.net) })),
    bySource: sources.map((s) => ({
      sourceType: s.sourceType,
      count: s.count,
      gross: money(s.gross),
      taxDeducted: money(s.tax),
      net: money(s.net),
      sharePercent: totalNet.isZero() ? '0.00' : dec(s.net).div(totalNet).times(100).toFixed(2),
    })),
  };
}
