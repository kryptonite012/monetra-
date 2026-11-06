import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createUser, type TestUser } from '../helpers/api';
import { resetDatabase } from '../helpers/db';

describe('categories, merchants and auto-categorisation', () => {
  let user: TestUser;
  beforeAll(async () => {
    await resetDatabase();
    user = await createUser();
  });
  afterAll(resetDatabase);

  it('returns the system tree and supports custom sub-categories', async () => {
    const tree = await api().get('/api/v1/categories?tree=true&kind=expense').set(user.auth);
    const food = tree.body.data.find((c: { slug: string }) => c.slug === 'food');
    expect(food.children.map((c: { name: string }) => c.name)).toContain('Groceries');

    const created = await api().post('/api/v1/categories').set(user.auth).send({ name: 'Street Food', kind: 'expense', parentId: food.id, color: '#ff7700' });
    expect(created.status).toBe(201);
    const nested = await api().post('/api/v1/categories').set(user.auth).send({ name: 'Too Deep', kind: 'expense', parentId: created.body.data.id });
    expect(nested.status).toBe(422);
    const wrongKind = await api().post('/api/v1/categories').set(user.auth).send({ name: 'Bonus', kind: 'income', parentId: food.id });
    expect(wrongKind.status).toBe(422);

    const other = await createUser();
    const hidden = await api().get('/api/v1/categories').set(other.auth);
    expect(hidden.body.data.some((c: { name: string }) => c.name === 'Street Food')).toBe(false);
    expect((await api().patch(`/api/v1/categories/${created.body.data.id}`).set(other.auth).send({ name: 'Hack' })).status).toBe(404);
  });

  it('suggests categories from built-in keywords with an explanation', async () => {
    const res = await api().post('/api/v1/categories/suggest').set(user.auth).send({ description: 'UPI-SWIGGY-ORDER 8812' });
    expect(res.body.data).toMatchObject({ categoryName: 'Food Delivery', source: 'keyword' });
    expect(res.body.data.explanation).toMatch(/swiggy/i);
    const none = await api().post('/api/v1/categories/suggest').set(user.auth).send({ description: 'zzqx 1234' });
    expect(none.body.data.categoryId).toBeNull();
  });

  it('prefers user rules, then merchant defaults', async () => {
    const cats = (await api().get('/api/v1/categories?kind=expense').set(user.auth)).body.data;
    const fuel = cats.find((c: { slug: string }) => c.slug === 'transport.fuel');
    const groceries = cats.find((c: { slug: string }) => c.slug === 'food.groceries');

    const merchant = await api().post('/api/v1/merchants').set(user.auth).send({ name: 'Sharma General Store Pvt Ltd', defaultCategoryId: groceries.id });
    expect(merchant.body.data.normalizedName).toBe('sharma general store');
    const byMerchant = await api().post('/api/v1/categories/suggest').set(user.auth).send({ description: 'payment', merchantId: merchant.body.data.id });
    expect(byMerchant.body.data).toMatchObject({ source: 'merchant', categoryName: 'Groceries' });

    await api().post('/api/v1/categorization-rules').set(user.auth).send({ pattern: 'swiggy', categoryId: fuel.id, priority: 1 });
    const byRule = await api().post('/api/v1/categories/suggest').set(user.auth).send({ description: 'SWIGGY order' });
    expect(byRule.body.data).toMatchObject({ source: 'rule', categoryName: 'Fuel' });
    const rules = await api().get('/api/v1/categorization-rules').set(user.auth);
    expect(rules.body.data[0].timesApplied).toBe(1);

    // Partial updates must not reset other fields to their defaults.
    const patched = await api().patch(`/api/v1/categorization-rules/${rules.body.data[0].id}`).set(user.auth).send({ pattern: 'swiggy instamart' });
    expect(patched.body.data).toMatchObject({ pattern: 'swiggy instamart', priority: 1, matchField: 'any' });
  });
});
