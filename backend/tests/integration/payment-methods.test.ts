import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createUser, type TestUser } from '../helpers/api';
import { resetDatabase } from '../helpers/db';

describe('payment methods', () => {
  let user: TestUser;
  beforeAll(async () => {
    await resetDatabase();
    user = await createUser();
  });
  afterAll(resetDatabase);

  it('stores UPI and card identifiers safely', async () => {
    const upi = await api().post('/api/v1/payment-methods').set(user.auth).send({ type: 'upi', label: 'PhonePe', upiVpa: 'Asha.K@ybl', upiApp: 'PhonePe', isDefault: true });
    expect(upi.status).toBe(201);
    expect(upi.body.data.upiVpa).toBe('asha.k@ybl');
    const card = await api().post('/api/v1/payment-methods').set(user.auth).send({ type: 'credit_card', label: 'HDFC Regalia', cardNetwork: 'visa', cardLast4: '4242', isDefault: true });
    expect(card.status).toBe(201);
    const list = await api().get('/api/v1/payment-methods').set(user.auth);
    expect(list.body.data.filter((p: { isDefault: boolean }) => p.isDefault)).toHaveLength(1);
    expect(list.body.data[0].label).toBe('HDFC Regalia');
  });

  it('refuses secrets: card numbers, CVV, PINs and OTPs', async () => {
    const pan = await api().post('/api/v1/payment-methods').set(user.auth).send({ type: 'debit_card', label: 'Card 4111 1111 1111 1111' });
    expect(pan.status).toBe(422);
    const cvv = await api().post('/api/v1/payment-methods').set(user.auth).send({ type: 'debit_card', label: 'SBI Debit', cardLast4: '1234', cvv: '123' });
    expect(cvv.status).toBe(422);
    expect(JSON.stringify(cvv.body)).toMatch(/never stores/);
    const pin = await api().post('/api/v1/payment-methods').set(user.auth).send({ type: 'upi', label: 'GPay', upiVpa: 'a@okicici', upiPin: '1234' });
    expect(pin.status).toBe(422);
    const mismatch = await api().post('/api/v1/payment-methods').set(user.auth).send({ type: 'cash', label: 'Cash', cardLast4: '1234' });
    expect(mismatch.status).toBe(422);
  });
});
