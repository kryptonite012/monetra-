import { z } from 'zod';
import { db, withTransaction } from '../../db/knex';
import { todayIn } from '../../lib/dates';
import { badRequest, conflict, notFound, unprocessable } from '../../lib/errors';
import { apiRouter, idParams, isoDate, optionalText, queryBool } from '../../lib/http';
import { money, positiveMoney } from '../../lib/money';
import { requireOwnedRef } from '../../lib/ownership';
import { guarded } from '../../lib/sensitive';
import { audit } from '../audit/audit.service';
import { categoryBySlug, resolveCategory } from '../categories/categories.service';
import { postTransaction, postTransfer } from '../transactions/ledger.service';
import { BILL_TYPE_CATEGORY, dueStatus, monthlyEquivalent, nextBillDue, nextRenewal, subscriptionSummary, upcomingPayments } from './bills.service';

// --------------------------------------------------------------------- bills
export const bills = apiRouter('/bills', 'Bills & subscriptions');

const BILL_TYPES = ['electricity', 'water', 'gas', 'internet', 'mobile', 'dth', 'rent', 'insurance', 'maintenance', 'education', 'credit_card', 'tax', 'other'] as const;
const billFields = z.object({
  name: z.string().trim().min(2).max(80),
  biller: optionalText(120),
  billType: z.enum(BILL_TYPES),
  categoryId: z.uuid().nullish(),
  consumerNumber: z.string().trim().max(40).nullish(),
  amountType: z.enum(['fixed', 'variable']),
  expectedAmount: positiveMoney.nullish(),
  frequency: z.enum(['monthly', 'bimonthly', 'quarterly', 'half_yearly', 'yearly']),
  nextDueDate: isoDate,
  reminderDaysBefore: z.number().int().min(0).max(30),
  autoPay: z.boolean(),
  defaultAccountId: z.uuid().nullish(),
  paymentMethodId: z.uuid().nullish(),
  status: z.enum(['active', 'paused', 'cancelled']),
  notes: optionalText(1000),
});

function billRow(v: Partial<z.infer<typeof billFields>>) {
  return Object.fromEntries(
    Object.entries({
      name: v.name,
      biller: v.biller,
      bill_type: v.billType,
      category_id: v.categoryId,
      consumer_number: v.consumerNumber,
      amount_type: v.amountType,
      expected_amount: v.expectedAmount,
      frequency: v.frequency,
      next_due_date: v.nextDueDate,
      reminder_days_before: v.reminderDaysBefore,
      auto_pay: v.autoPay,
      default_account_id: v.defaultAccountId,
      payment_method_id: v.paymentMethodId,
      status: v.status,
      notes: v.notes,
    }).filter(([, val]) => val !== undefined),
  );
}

const serializeBill = (b: Record<string, any>) => ({ ...b, expectedAmount: b.expectedAmount != null ? money(b.expectedAmount) : null, ...dueStatus(b.nextDueDate, b.reminderDaysBefore) });

async function validateBillRefs(userId: string, v: Partial<z.infer<typeof billFields>>) {
  await requireOwnedRef('accounts', v.defaultAccountId, userId, 'defaultAccountId');
  await requireOwnedRef('payment_methods', v.paymentMethodId, userId, 'paymentMethodId');
  if (v.categoryId) await resolveCategory(userId, v.categoryId, 'expense');
}

bills.get('/', {
  summary: 'List bills with due status',
  query: z.object({ includeInactive: queryBool.optional() }),
  handler: async ({ user, query }) => {
    const q = db('bills').where({ user_id: user.id }).orderBy('next_due_date');
    if (!query.includeInactive) q.where({ status: 'active' });
    return (await q).map(serializeBill);
  },
});

bills.get('/upcoming', {
  summary: 'Bills and subscription renewals due soon (including overdue)',
  query: z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }),
  handler: ({ user, query }) => upcomingPayments(user.id, query.days),
});

bills.post('/', {
  summary: 'Add a recurring bill',
  status: 201,
  body: guarded(billFields.extend({ amountType: billFields.shape.amountType.default('variable'), frequency: billFields.shape.frequency.default('monthly'), reminderDaysBefore: billFields.shape.reminderDaysBefore.default(3), autoPay: z.boolean().default(false), status: billFields.shape.status.default('active') })),
  handler: async ({ user, body, req }) => {
    await validateBillRefs(user.id, body);
    if (body.amountType === 'fixed' && !body.expectedAmount) throw unprocessable('Fixed bills need an amount', { field: 'expectedAmount' });
    const [row] = await db('bills').insert({ user_id: user.id, ...billRow(body) }).returning('*');
    await audit({ action: 'bill.created', req, entityType: 'bill', entityId: row.id });
    return serializeBill(row);
  },
});

bills.patch('/:id', {
  summary: 'Update a bill',
  params: idParams,
  body: guarded(billFields.partial()),
  handler: async ({ user, params, body }) => {
    await validateBillRefs(user.id, body);
    const patch = billRow(body);
    if (!Object.keys(patch).length) throw badRequest('Nothing to update');
    const [row] = await db('bills').where({ id: params.id, user_id: user.id }).update(patch).returning('*');
    if (!row) throw notFound('Bill');
    return serializeBill(row);
  },
});

bills.delete('/:id', {
  summary: 'Delete a bill (payment history in the ledger is kept)',
  params: idParams,
  handler: async ({ user, params }) => {
    const deleted = await db('bills').where({ id: params.id, user_id: user.id }).delete();
    if (!deleted) throw notFound('Bill');
    return undefined;
  },
});

bills.post('/:id/pay', {
  summary: 'Record a bill payment and move the due date forward',
  params: idParams,
  body: z.object({
    amount: positiveMoney.optional(),
    paidOn: isoDate.default(() => todayIn()),
    accountId: z.uuid().optional(),
    cardAccountId: z.uuid().optional(),
    paymentMethodId: z.uuid().nullish(),
    reference: optionalText(64),
    note: optionalText(300),
  }),
  handler: async ({ user, params, body, req }) => {
    const result = await withTransaction(async (trx) => {
      const bill = await trx('bills').where({ id: params.id, user_id: user.id }).forUpdate().first();
      if (!bill) throw notFound('Bill');
      if (bill.status === 'cancelled') throw conflict('This bill is cancelled');
      const amount = body.amount ?? bill.expectedAmount;
      if (!amount) throw unprocessable('Enter the amount paid', { field: 'amount' });
      const accountId = body.accountId ?? bill.defaultAccountId;
      if (!accountId) throw unprocessable('Choose the account the bill was paid from', { field: 'accountId' });
      let transactionId: string;
      if (bill.billType === 'credit_card') {
        if (!body.cardAccountId) throw unprocessable('Choose the credit card account being paid', { field: 'cardAccountId' });
        const t = await postTransfer({ userId: user.id, fromAccountId: accountId, toAccountId: body.cardAccountId, amount, occurredOn: body.paidOn, description: `${bill.name} payment`, reference: body.reference }, trx);
        transactionId = t.debit.id;
      } else {
        const txn = await postTransaction(
          {
            userId: user.id,
            accountId,
            kind: 'bill_payment',
            amount,
            occurredOn: body.paidOn,
            description: `${bill.name}${bill.biller ? ` – ${bill.biller}` : ''}`,
            categoryId: bill.categoryId ?? (await categoryBySlug(BILL_TYPE_CATEGORY[bill.billType] ?? 'expense.other', trx)),
            paymentMethodId: body.paymentMethodId ?? bill.paymentMethodId,
            reference: body.reference,
            counterparty: bill.biller,
            autoCategorize: false,
            allowDuplicate: true,
            metadata: { billId: bill.id },
          },
          trx,
        );
        transactionId = txn.id;
      }
      const [payment] = await trx('bill_payments')
        .insert({ user_id: user.id, bill_id: bill.id, amount, paid_on: body.paidOn, period_due_date: bill.nextDueDate, transaction_id: transactionId, note: body.note ?? null })
        .returning('*');
      const [updated] = await trx('bills').where({ id: bill.id }).update({ next_due_date: nextBillDue(bill.nextDueDate, bill.frequency) }).returning('*');
      return { payment, bill: updated };
    });
    await audit({ action: 'bill.paid', req, entityType: 'bill', entityId: params.id, metadata: { amount: result.payment.amount } });
    return { payment: { ...result.payment, amount: money(result.payment.amount) }, bill: serializeBill(result.bill) };
  },
});

bills.get('/:id/payments', {
  summary: 'Payment history for a bill',
  params: idParams,
  handler: async ({ user, params }) => {
    const bill = await db('bills').where({ id: params.id, user_id: user.id }).first('id');
    if (!bill) throw notFound('Bill');
    const rows = await db('bill_payments').where({ bill_id: params.id }).orderBy('paid_on', 'desc');
    return rows.map((p: any) => ({ ...p, amount: money(p.amount) }));
  },
});

// ------------------------------------------------------------- subscriptions
export const subscriptions = apiRouter('/subscriptions', 'Bills & subscriptions');

const subFields = z.object({
  name: z.string().trim().min(2).max(80),
  provider: optionalText(120),
  plan: optionalText(80),
  amount: positiveMoney,
  billingCycle: z.enum(['weekly', 'monthly', 'quarterly', 'half_yearly', 'yearly']),
  startDate: isoDate.nullish(),
  nextRenewalDate: isoDate,
  categoryId: z.uuid().nullish(),
  defaultAccountId: z.uuid().nullish(),
  paymentMethodId: z.uuid().nullish(),
  autoRenew: z.boolean(),
  reminderDaysBefore: z.number().int().min(0).max(30),
  lastUsedOn: isoDate.nullish(),
  status: z.enum(['active', 'paused', 'cancelled']),
  notes: optionalText(1000),
});

function subRow(v: Partial<z.infer<typeof subFields>>) {
  return Object.fromEntries(
    Object.entries({
      name: v.name,
      provider: v.provider,
      plan: v.plan,
      amount: v.amount,
      billing_cycle: v.billingCycle,
      start_date: v.startDate,
      next_renewal_date: v.nextRenewalDate,
      category_id: v.categoryId,
      default_account_id: v.defaultAccountId,
      payment_method_id: v.paymentMethodId,
      auto_renew: v.autoRenew,
      reminder_days_before: v.reminderDaysBefore,
      last_used_on: v.lastUsedOn,
      status: v.status,
      notes: v.notes,
    }).filter(([, val]) => val !== undefined),
  );
}

const serializeSub = (s: Record<string, any>) => ({
  ...s,
  amount: money(s.amount),
  monthlyEquivalent: money(monthlyEquivalent(s.amount, s.billingCycle)),
  ...dueStatus(s.nextRenewalDate, s.reminderDaysBefore),
});

subscriptions.get('/', {
  summary: 'List subscriptions',
  query: z.object({ includeInactive: queryBool.optional() }),
  handler: async ({ user, query }) => {
    const q = db('subscriptions').where({ user_id: user.id }).orderBy('next_renewal_date');
    if (!query.includeInactive) q.whereNot({ status: 'cancelled' });
    return (await q).map(serializeSub);
  },
});

subscriptions.get('/summary', {
  summary: 'Monthly/yearly subscription cost and subscriptions you may not be using',
  handler: ({ user }) => subscriptionSummary(user.id),
});

subscriptions.post('/', {
  summary: 'Add a subscription',
  status: 201,
  body: guarded(subFields.extend({ billingCycle: subFields.shape.billingCycle.default('monthly'), autoRenew: z.boolean().default(true), reminderDaysBefore: subFields.shape.reminderDaysBefore.default(3), status: subFields.shape.status.default('active') })),
  handler: async ({ user, body, req }) => {
    await requireOwnedRef('accounts', body.defaultAccountId, user.id, 'defaultAccountId');
    await requireOwnedRef('payment_methods', body.paymentMethodId, user.id, 'paymentMethodId');
    if (body.categoryId) await resolveCategory(user.id, body.categoryId, 'expense');
    const [row] = await db('subscriptions').insert({ user_id: user.id, ...subRow(body) }).returning('*');
    await audit({ action: 'subscription.created', req, entityType: 'subscription', entityId: row.id });
    return serializeSub(row);
  },
});

subscriptions.patch('/:id', {
  summary: 'Update a subscription',
  params: idParams,
  body: guarded(subFields.partial()),
  handler: async ({ user, params, body }) => {
    await requireOwnedRef('accounts', body.defaultAccountId, user.id, 'defaultAccountId');
    if (body.categoryId) await resolveCategory(user.id, body.categoryId, 'expense');
    const patch = subRow(body);
    if (!Object.keys(patch).length) throw badRequest('Nothing to update');
    const [row] = await db('subscriptions').where({ id: params.id, user_id: user.id }).update(patch).returning('*');
    if (!row) throw notFound('Subscription');
    return serializeSub(row);
  },
});

subscriptions.post('/:id/pay', {
  summary: 'Record a renewal payment and roll the renewal date forward',
  params: idParams,
  body: z.object({ amount: positiveMoney.optional(), paidOn: isoDate.default(() => todayIn()), accountId: z.uuid().optional(), paymentMethodId: z.uuid().nullish() }),
  handler: async ({ user, params, body, req }) => {
    const result = await withTransaction(async (trx) => {
      const sub = await trx('subscriptions').where({ id: params.id, user_id: user.id }).forUpdate().first();
      if (!sub) throw notFound('Subscription');
      if (sub.status === 'cancelled') throw conflict('This subscription is cancelled');
      const accountId = body.accountId ?? sub.defaultAccountId;
      if (!accountId) throw unprocessable('Choose the account the renewal was paid from', { field: 'accountId' });
      const amount = body.amount ?? sub.amount;
      const txn = await postTransaction(
        {
          userId: user.id,
          accountId,
          kind: 'bill_payment',
          amount,
          occurredOn: body.paidOn,
          description: `${sub.name} subscription${sub.plan ? ` (${sub.plan})` : ''}`,
          categoryId: sub.categoryId ?? (await categoryBySlug('entertainment.ott', trx)),
          paymentMethodId: body.paymentMethodId ?? sub.paymentMethodId,
          counterparty: sub.provider,
          autoCategorize: false,
          allowDuplicate: true,
          metadata: { subscriptionId: sub.id },
        },
        trx,
      );
      const [payment] = await trx('bill_payments').insert({ user_id: user.id, subscription_id: sub.id, amount, paid_on: body.paidOn, period_due_date: sub.nextRenewalDate, transaction_id: txn.id }).returning('*');
      const [updated] = await trx('subscriptions').where({ id: sub.id }).update({ next_renewal_date: nextRenewal(sub.nextRenewalDate, sub.billingCycle) }).returning('*');
      return { payment, sub: updated };
    });
    await audit({ action: 'subscription.paid', req, entityType: 'subscription', entityId: params.id });
    return { payment: { ...result.payment, amount: money(result.payment.amount) }, subscription: serializeSub(result.sub) };
  },
});

subscriptions.post('/:id/cancel', {
  summary: 'Mark a subscription as cancelled',
  params: idParams,
  body: z.object({ cancelledOn: isoDate.default(() => todayIn()) }),
  handler: async ({ user, params, body, req }) => {
    const [row] = await db('subscriptions').where({ id: params.id, user_id: user.id }).update({ status: 'cancelled', cancelled_on: body.cancelledOn, auto_renew: false }).returning('*');
    if (!row) throw notFound('Subscription');
    await audit({ action: 'subscription.cancelled', req, entityType: 'subscription', entityId: params.id });
    return serializeSub(row);
  },
});

subscriptions.post('/:id/used', {
  summary: 'Record that you used a subscription (helps detect unused ones)',
  params: idParams,
  body: z.object({ usedOn: isoDate.default(() => todayIn()) }),
  handler: async ({ user, params, body }) => {
    const [row] = await db('subscriptions').where({ id: params.id, user_id: user.id }).update({ last_used_on: body.usedOn }).returning('*');
    if (!row) throw notFound('Subscription');
    return serializeSub(row);
  },
});

subscriptions.get('/:id/payments', {
  summary: 'Payment history for a subscription',
  params: idParams,
  handler: async ({ user, params }) => {
    const sub = await db('subscriptions').where({ id: params.id, user_id: user.id }).first('id');
    if (!sub) throw notFound('Subscription');
    const rows = await db('bill_payments').where({ subscription_id: params.id }).orderBy('paid_on', 'desc');
    return rows.map((p: any) => ({ ...p, amount: money(p.amount) }));
  },
});

subscriptions.delete('/:id', {
  summary: 'Delete a subscription record',
  params: idParams,
  handler: async ({ user, params }) => {
    const deleted = await db('subscriptions').where({ id: params.id, user_id: user.id }).delete();
    if (!deleted) throw notFound('Subscription');
    return undefined;
  },
});
