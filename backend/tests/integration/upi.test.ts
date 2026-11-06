import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createUser, type TestUser } from '../helpers/api';
import { resetDatabase } from '../helpers/db';
import { categoryId, createAccount } from '../helpers/fixtures';

describe('UPI payments', () => {
  let user: TestUser;
  let bank: { id: string };
  let upiMethod: string;

  beforeAll(async () => {
    await resetDatabase();
    user = await createUser();
    bank = await createAccount(user, { name: 'Kotak 811', openingBalance: '20000' });
    upiMethod = (await api().post('/api/v1/payment-methods').set(user.auth).send({ type: 'upi', label: 'GPay', upiVpa: 'me@okicici' })).body.data.id;
  });
  afterAll(resetDatabase);

  it('parses QR payloads with category hints', async () => {
    const res = await api().post('/api/v1/upi/parse-qr').set(user.auth).send({ payload: 'upi://pay?pa=hpcl.pump@icici&pn=HPCL&mc=5541&am=1500' });
    expect(res.body.data).toMatchObject({ payeeVpa: 'hpcl.pump@icici', amount: '1500', suggestedCategoryId: await categoryId('transport.fuel') });
    const bad = await api().post('/api/v1/upi/parse-qr').set(user.auth).send({ payload: 'not-a-upi-qr-code' });
    expect(bad.status).toBe(422);
  });

  it('records outgoing and incoming UPI payments with references', async () => {
    const out = await api()
      .post('/api/v1/upi/transactions')
      .set(user.auth)
      .send({ accountId: bank.id, direction: 'outgoing', amount: '1500', upiRef: '612345678901', paymentMethodId: upiMethod, qrPayload: 'upi://pay?pa=hpcl.pump@icici&pn=HPCL%20Fuel&mc=5541' });
    expect(out.status).toBe(201);
    expect(out.body.data).toMatchObject({ reference: '612345678901', counterparty: 'hpcl.pump@icici', categoryId: await categoryId('transport.fuel'), kind: 'expense' });
    const inn = await api().post('/api/v1/upi/transactions').set(user.auth).send({ accountId: bank.id, direction: 'incoming', amount: '800', counterpartyVpa: 'rahul@ybl', counterpartyName: 'Rahul', note: 'Dinner split' });
    expect(inn.body.data.kind).toBe('income');
    const pin = await api().post('/api/v1/upi/transactions').set(user.auth).send({ accountId: bank.id, direction: 'outgoing', amount: '1', upiPin: '123456' });
    expect(pin.status).toBe(422);
  });

  it('summarises UPI activity', async () => {
    await api().post('/api/v1/transactions').set(user.auth).send({ accountId: bank.id, kind: 'expense', amount: '99', description: 'Cash snack' });
    const list = await api().get('/api/v1/upi/transactions').set(user.auth);
    expect(list.body.meta.total).toBe(2);
    const summary = await api().get('/api/v1/upi/summary').set(user.auth);
    expect(summary.body.data).toMatchObject({ incoming: '800.00', outgoing: '1500.00', net: '-700.00', outgoingCount: 1 });
    expect(summary.body.data.topCounterparties[0].counterparty).toBe('hpcl.pump@icici');
  });
});
