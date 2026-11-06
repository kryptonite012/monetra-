import { db, type Db } from '../../db/knex';
import { AppError, unprocessable } from '../../lib/errors';
import { dec, money, storage, sum } from '../../lib/money';
import { findOwned } from '../../lib/ownership';

export const LIABILITY_ACCOUNT_TYPES = new Set(['credit_card', 'overdraft']);

const SIGNED = `CASE WHEN t.direction = 'credit' THEN t.amount ELSE -t.amount END`;

/** Balance of one account on a date (inclusive), computed from the ledger. */
export async function balanceAsOf(accountId: string, asOf?: string, conn: Db = db): Promise<string> {
  const q = conn('accounts as a')
    .leftJoin('transactions as t', function join() {
      this.on('t.account_id', 'a.id');
      if (asOf) this.andOn('t.occurred_on', '<=', conn.raw('?', [asOf]));
    })
    .where('a.id', accountId)
    .groupBy('a.id')
    .first(conn.raw(`a.opening_balance + COALESCE(SUM(${SIGNED}), 0) AS balance`));
  const row = await q;
  return storage(row?.balance ?? 0);
}

/** Every account for a user with its computed balance and activity stats. */
export async function listAccounts(userId: string, opts: { includeClosed?: boolean } = {}, conn: Db = db) {
  const q = conn('accounts as a')
    .join('account_current_balances as b', 'b.account_id', 'a.id')
    .where('a.user_id', userId)
    .select('a.*', 'b.balance', 'b.transaction_count', 'b.last_transaction_on')
    .orderBy([{ column: 'a.is_active', order: 'desc' }, { column: 'a.created_at' }]);
  if (!opts.includeClosed) q.where('a.is_active', true);
  const rows: Array<Record<string, any>> = await q;
  return rows.map(decorateAccount);
}

export function decorateAccount(row: Record<string, any>): Record<string, any> {
  const balance = dec(row.balance ?? row.openingBalance);
  const isLiability = LIABILITY_ACCOUNT_TYPES.has(row.type);
  return {
    ...row,
    balance: money(balance),
    isLiability,
    // A negative balance on a card/overdraft is the amount owed.
    outstanding: isLiability && balance.isNegative() ? money(balance.abs()) : '0.00',
    availableCredit: row.creditLimit != null ? money(dec(row.creditLimit).plus(balance)) : null,
    utilizationPercent:
      row.creditLimit != null && dec(row.creditLimit).gt(0) && balance.isNegative()
        ? balance.abs().div(row.creditLimit).times(100).toDecimalPlaces(1).toString()
        : null,
    dataSourceLabel: row.dataSource === 'manual' ? 'Manually tracked' : row.dataSource,
  };
}

export async function accountsSummary(userId: string, conn: Db = db) {
  const accounts = await listAccounts(userId, {}, conn);
  const included = accounts.filter((a) => a.includeInNetWorth);
  const assets = included.filter((a) => !a.isLiability || dec(a.balance).gt(0));
  const liquid = sum(assets.filter((a) => !a.isLiability).map((a) => a.balance));
  const cardOutstanding = sum(included.map((a) => a.outstanding));
  const byType: Record<string, { count: number; balance: string }> = {};
  for (const a of accounts) {
    const entry = (byType[a.type] ??= { count: 0, balance: '0.00' });
    entry.count += 1;
    entry.balance = money(dec(entry.balance).plus(a.balance));
  }
  return {
    accountCount: accounts.length,
    totalAvailableBalance: money(liquid),
    creditCardOutstanding: money(cardOutstanding),
    netAccountBalance: money(sum(included.map((a) => a.balance))),
    byType,
  };
}

/** Loads an account for posting entries; closed accounts cannot receive new transactions. */
export async function requireOpenAccount(userId: string, accountId: string, conn: Db = db) {
  const account = await conn('accounts').where({ id: accountId, user_id: userId }).first();
  if (!account) throw unprocessable('Account not found', { field: 'accountId' });
  if (!account.isActive) throw new AppError(409, 'ACCOUNT_CLOSED', `${account.name} is closed; reopen it to record transactions`);
  return account;
}

export async function getAccount(userId: string, id: string) {
  await findOwned('accounts', id, userId, 'Account');
  const [account] = (await listAccounts(userId, { includeClosed: true })).filter((a) => a.id === id);
  const { rows: monthly } = await db.raw(
    `SELECT to_char(date_trunc('month', occurred_on), 'YYYY-MM') AS month,
            COALESCE(SUM(amount) FILTER (WHERE direction = 'credit'), 0) AS inflow,
            COALESCE(SUM(amount) FILTER (WHERE direction = 'debit'), 0) AS outflow
       FROM transactions
      WHERE account_id = ? AND occurred_on >= date_trunc('month', CURRENT_DATE) - interval '5 months'
      GROUP BY 1 ORDER BY 1`,
    [id],
  );
  return {
    ...account,
    monthly: monthly.map((m: Record<string, string>) => ({ month: m.month, inflow: money(m.inflow), outflow: money(m.outflow), net: money(dec(m.inflow).minus(m.outflow)) })),
  };
}
