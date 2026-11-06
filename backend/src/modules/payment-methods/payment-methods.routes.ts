import { z } from 'zod';
import { db } from '../../db/knex';
import { notFound } from '../../lib/errors';
import { apiRouter, idParams } from '../../lib/http';
import { requireOwnedRef } from '../../lib/ownership';
import { guarded } from '../../lib/sensitive';
import { audit } from '../audit/audit.service';

const r = apiRouter('/payment-methods', 'Payment methods');

const vpa = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{2,128}@[a-z][a-z0-9.-]{1,64}$/, 'Enter a valid UPI ID such as name@okhdfcbank');

const fields = z.object({
  type: z.enum(['cash', 'upi', 'debit_card', 'credit_card', 'net_banking', 'wallet', 'cheque', 'other']),
  label: z.string().trim().min(2).max(60),
  upiVpa: vpa.nullish(),
  upiApp: z.string().trim().max(40).nullish(),
  cardNetwork: z.enum(['visa', 'mastercard', 'rupay', 'amex', 'diners', 'discover', 'other']).nullish(),
  cardLast4: z.string().regex(/^\d{4}$/, 'Enter only the last 4 digits').nullish(),
  cardExpiryMonth: z.number().int().min(1).max(12).nullish(),
  cardExpiryYear: z.number().int().min(2000).max(2100).nullish(),
  linkedAccountId: z.uuid().nullish(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

function cardRules(v: Partial<z.infer<typeof fields>>, ctx: z.RefinementCtx) {
  const isCard = v.type === 'debit_card' || v.type === 'credit_card';
  if (v.type && !isCard && (v.cardLast4 || v.cardNetwork)) ctx.addIssue({ code: 'custom', path: ['cardLast4'], message: 'Card details apply only to cards' });
  if (v.type && v.type !== 'upi' && v.upiVpa) ctx.addIssue({ code: 'custom', path: ['upiVpa'], message: 'UPI ID applies only to UPI methods' });
}

const createBody = guarded(z.strictObject(fields.shape).superRefine(cardRules));
const updateBody = guarded(z.strictObject(fields.partial().shape).superRefine(cardRules));

function toRow(userId: string, v: Partial<z.infer<typeof fields>>) {
  return Object.fromEntries(
    Object.entries({
      user_id: userId,
      type: v.type,
      label: v.label,
      upi_vpa: v.upiVpa,
      upi_app: v.upiApp,
      card_network: v.cardNetwork,
      card_last4: v.cardLast4,
      card_expiry_month: v.cardExpiryMonth,
      card_expiry_year: v.cardExpiryYear,
      linked_account_id: v.linkedAccountId,
      is_default: v.isDefault,
      is_active: v.isActive,
    }).filter(([, val]) => val !== undefined),
  );
}

r.get('/', {
  summary: 'List payment methods',
  handler: ({ user }) =>
    db('payment_methods as p')
      .leftJoin('accounts as a', 'a.id', 'p.linked_account_id')
      .where('p.user_id', user.id)
      .select('p.*', 'a.name as linked_account_name')
      .orderBy([{ column: 'p.is_default', order: 'desc' }, { column: 'p.label' }]),
});

r.post('/', {
  summary: 'Add a payment method (stores only non-secret identifiers)',
  status: 201,
  body: createBody,
  handler: async ({ user, body, req }) => {
    await requireOwnedRef('accounts', body.linkedAccountId, user.id, 'linkedAccountId');
    const row = await db.transaction(async (trx) => {
      if (body.isDefault) await trx('payment_methods').where({ user_id: user.id }).update({ is_default: false });
      const [created] = await trx('payment_methods').insert(toRow(user.id, body)).returning('*');
      return created;
    });
    await audit({ action: 'payment_method.created', req, entityType: 'payment_method', entityId: row.id, metadata: { type: row.type } });
    return row;
  },
});

r.patch('/:id', {
  summary: 'Update a payment method',
  params: idParams,
  body: updateBody,
  handler: async ({ user, params, body }) => {
    await requireOwnedRef('accounts', body.linkedAccountId, user.id, 'linkedAccountId');
    return db.transaction(async (trx) => {
      if (body.isDefault) await trx('payment_methods').where({ user_id: user.id }).whereNot({ id: params.id }).update({ is_default: false });
      const { user_id: _u, ...patch } = toRow(user.id, body);
      const [row] = await trx('payment_methods').where({ id: params.id, user_id: user.id }).update(patch).returning('*');
      if (!row) throw notFound('Payment method');
      return row;
    });
  },
});

r.delete('/:id', {
  summary: 'Remove a payment method (deactivated instead if it has history)',
  params: idParams,
  handler: async ({ user, params, req }) => {
    const used = await db('transactions').where({ payment_method_id: params.id, user_id: user.id }).first('id');
    if (used) {
      const [row] = await db('payment_methods').where({ id: params.id, user_id: user.id }).update({ is_active: false, is_default: false }).returning('*');
      if (!row) throw notFound('Payment method');
      await audit({ action: 'payment_method.deactivated', req, entityType: 'payment_method', entityId: params.id });
      return row;
    }
    const deleted = await db('payment_methods').where({ id: params.id, user_id: user.id }).delete();
    if (!deleted) throw notFound('Payment method');
    await audit({ action: 'payment_method.deleted', req, entityType: 'payment_method', entityId: params.id });
    return undefined;
  },
});

export default r.router;
