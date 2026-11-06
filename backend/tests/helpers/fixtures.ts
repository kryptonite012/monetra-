import { db } from '../../src/db/knex';
import { api, type TestUser } from './api';

export async function createAccount(user: TestUser, body: Record<string, unknown> = {}) {
  const res = await api()
    .post('/api/v1/accounts')
    .set(user.auth)
    .send({ name: `Account ${Math.random().toString(36).slice(2, 8)}`, type: 'savings', openingBalance: '0', ...body });
  if (res.status !== 201) throw new Error(`account create failed: ${JSON.stringify(res.body)}`);
  return res.body.data as { id: string; name: string; balance: string };
}

export async function categoryId(slug: string): Promise<string> {
  const row = await db('transaction_categories').where({ slug }).first('id');
  if (!row) throw new Error(`no category ${slug}`);
  return row.id;
}

export async function balanceOf(user: TestUser, accountId: string): Promise<string> {
  const res = await api().get(`/api/v1/accounts/${accountId}`).set(user.auth);
  return res.body.data.balance;
}
