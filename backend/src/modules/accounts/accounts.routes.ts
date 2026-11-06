import { z } from 'zod';
import { db } from '../../db/knex';
import { conflict, notFound, unprocessable } from '../../lib/errors';
import { apiRouter, currencyCode, idParams, isoDate, optionalText, queryBool } from '../../lib/http';
import { dec, moneySchema, nonNegativeMoney } from '../../lib/money';
import { findOwned } from '../../lib/ownership';
import { guarded } from '../../lib/sensitive';
import { audit } from '../audit/audit.service';
import { accountsSummary, balanceAsOf, getAccount, listAccounts } from './accounts.service';

const r = apiRouter('/accounts', 'Accounts');

const accountFields = z.object({
  name: z.string().trim().min(2).max(80),
  nickname: optionalText(40),
  type: z.enum(['savings', 'current', 'salary', 'cash', 'wallet', 'credit_card', 'overdraft', 'other']),
  institutionName: optionalText(120),
  accountNumberLast4: z.string().regex(/^\d{4}$/, 'Enter only the last 4 digits').nullish(),
  ifsc: z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Enter a valid 11-character IFSC').nullish(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  openingBalance: moneySchema,
  openingDate: isoDate,
  creditLimit: nonNegativeMoney.nullish(),
  includeInNetWorth: z.boolean(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish(),
  notes: optionalText(1000),
});

function toRow(v: Partial<z.infer<typeof accountFields>>) {
  return Object.fromEntries(
    Object.entries({
      name: v.name,
      nickname: v.nickname,
      type: v.type,
      institution_name: v.institutionName,
      account_number_last4: v.accountNumberLast4,
      ifsc: v.ifsc,
      currency: v.currency,
      opening_balance: v.openingBalance,
      opening_date: v.openingDate,
      credit_limit: v.creditLimit,
      include_in_net_worth: v.includeInNetWorth,
      color: v.color,
      notes: v.notes,
    }).filter(([, val]) => val !== undefined),
  );
}

r.get('/', {
  summary: 'List accounts with computed balances',
  query: z.object({ includeClosed: queryBool.optional() }),
  handler: ({ user, query }) => listAccounts(user.id, { includeClosed: query.includeClosed }),
});

r.get('/summary', {
  summary: 'Total available balance, card outstanding and balances by account type',
  handler: ({ user }) => accountsSummary(user.id),
});

r.post('/', {
  summary: 'Add an account (manually tracked)',
  status: 201,
  body: guarded(
    accountFields.extend({
      currency: currencyCode,
      openingBalance: moneySchema.default('0'),
      openingDate: isoDate.optional(),
      includeInNetWorth: z.boolean().default(true),
    }),
  ),
  handler: async ({ user, body, req }) => {
    if (body.creditLimit && !['credit_card', 'overdraft'].includes(body.type)) {
      throw unprocessable('Credit limits apply to credit cards and overdraft accounts');
    }
    const [row] = await db('accounts').insert({ user_id: user.id, ...toRow(body) }).returning('*');
    await audit({ action: 'account.created', req, entityType: 'account', entityId: row.id, metadata: { type: row.type, openingBalance: row.openingBalance } });
    return getAccount(user.id, row.id);
  },
});

r.get('/:id', {
  summary: 'Account details with balance and six-month flow summary',
  params: idParams,
  handler: ({ user, params }) => getAccount(user.id, params.id),
});

r.get('/:id/balance', {
  summary: 'Balance on a given date (computed from the ledger)',
  params: idParams,
  query: z.object({ asOf: isoDate.optional() }),
  handler: async ({ user, params, query }) => {
    await findOwned('accounts', params.id, user.id, 'Account');
    return { accountId: params.id, asOf: query.asOf ?? new Date().toISOString().slice(0, 10), balance: dec(await balanceAsOf(params.id, query.asOf)).toFixed(2) };
  },
});

r.patch('/:id', {
  summary: 'Update account details (opening balance only while the account has no transactions)',
  params: idParams,
  body: guarded(accountFields.omit({ currency: true, type: true }).partial()),
  handler: async ({ user, params, body, req }) => {
    const account = await findOwned('accounts', params.id, user.id, 'Account');
    if (body.openingBalance !== undefined || body.openingDate !== undefined) {
      const hasTxn = await db('transactions').where({ account_id: params.id }).first('id');
      if (hasTxn && (body.openingBalance !== undefined && !dec(body.openingBalance).eq(account.openingBalance))) {
        throw conflict('Opening balance cannot change once transactions exist; reconcile the account to post an adjustment instead');
      }
    }
    const patch = toRow(body);
    if (Object.keys(patch).length) await db('accounts').where({ id: params.id }).update(patch);
    await audit({ action: 'account.updated', req, entityType: 'account', entityId: params.id, metadata: { fields: Object.keys(body) } });
    return getAccount(user.id, params.id);
  },
});

r.post('/:id/close', {
  summary: 'Close an account (records the closing balance and blocks new entries)',
  params: idParams,
  body: z.object({ closedOn: isoDate.optional(), force: z.boolean().default(false) }),
  handler: async ({ user, params, body, req }) => {
    const account = await findOwned('accounts', params.id, user.id, 'Account');
    if (!account.isActive) throw conflict('Account is already closed');
    const balance = await balanceAsOf(params.id);
    if (!dec(balance).isZero() && !body.force) {
      throw conflict(`The account still has a balance of ${dec(balance).toFixed(2)}. Transfer it out or confirm to close anyway.`, { balance });
    }
    await db('accounts')
      .where({ id: params.id })
      .update({ is_active: false, closed_on: body.closedOn ?? db.raw('CURRENT_DATE'), closing_balance: balance });
    await audit({ action: 'account.closed', req, entityType: 'account', entityId: params.id, metadata: { closingBalance: balance } });
    return getAccount(user.id, params.id);
  },
});

r.post('/:id/reopen', {
  summary: 'Reopen a closed account',
  params: idParams,
  handler: async ({ user, params, req }) => {
    const [row] = await db('accounts').where({ id: params.id, user_id: user.id, is_active: false }).update({ is_active: true, closed_on: null, closing_balance: null }).returning('id');
    if (!row) throw notFound('Closed account');
    await audit({ action: 'account.reopened', req, entityType: 'account', entityId: params.id });
    return getAccount(user.id, params.id);
  },
});

r.delete('/:id', {
  summary: 'Delete an account that has no transactions',
  params: idParams,
  handler: async ({ user, params, req }) => {
    await findOwned('accounts', params.id, user.id, 'Account');
    const used = await db('transactions').where({ account_id: params.id }).first('id');
    if (used) throw conflict('This account has transactions. Close it instead to keep your history.');
    await db('accounts').where({ id: params.id }).delete();
    await audit({ action: 'account.deleted', req, entityType: 'account', entityId: params.id });
    return undefined;
  },
});

export default r.router;
