import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMonths, monthStart, todayIn } from '../../src/lib/dates';
import { api, createUser, type TestUser } from '../helpers/api';
import { resetDatabase } from '../helpers/db';
import { createAccount } from '../helpers/fixtures';

const ask = (user: TestUser, question: string) => api().post('/api/v1/assistant/ask').set(user.auth).send({ question });

describe('assistant Q&A', () => {
  let user: TestUser;
  beforeAll(async () => {
    await resetDatabase();
    user = await createUser();
    const bank = await createAccount(user, { name: 'Bank', openingBalance: '300000', openingDate: '2024-01-01' });
    const today = todayIn();
    for (let m = 3; m >= 0; m--) {
      const d = monthStart(addMonths(today, -m));
      await api().post('/api/v1/income').set(user.auth).send({ accountId: bank.id, sourceType: 'salary', grossAmount: '100000', occurredOn: d });
      await api().post('/api/v1/expenses').set(user.auth).send({ accountId: bank.id, amount: '30000', description: 'House rent', occurredOn: d });
      await api().post('/api/v1/expenses').set(user.auth).send({ accountId: bank.id, amount: '9000', description: 'Swiggy orders', merchantName: 'Swiggy', occurredOn: d });
    }
    await api().post('/api/v1/loans').set(user.auth).send({ name: 'Car loan', loanType: 'vehicle', lender: 'HDFC', principal: '600000', interestRate: '9', tenureMonths: 60, startDate: '2026-01-01' });
  });
  afterAll(resetDatabase);

  it('answers where the money went with facts', async () => {
    const res = await ask(user, 'Where did my money go this month?');
    expect(res.body.data.intent).toBe('where_money_went');
    expect(res.body.data.answer).toContain('₹39,000.00');
    expect(res.body.data.facts[0].label).toBe('Housing');
    expect(res.body.data.source).toMatch(/your Monetra records/);
  });

  it('answers savings, category, EMI and spend questions', async () => {
    const saved = await ask(user, 'How much did I save this month?');
    expect(saved.body.data.answer).toContain('You saved ₹61,000.00');
    expect(saved.body.data.assumptions.length).toBeGreaterThan(0);
    const top = await ask(user, 'Which category consumes most of my income?');
    expect(top.body.data.answer).toMatch(/^Housing consumes the most/);
    const emi = await ask(user, 'How much EMI do I have remaining?');
    expect(emi.body.data.answer).toContain('₹6,00,000.00 principal outstanding');
    const food = await ask(user, 'How much did I spend on food last month?');
    expect(food.body.data.answer).toContain('₹9,000.00');
  });

  it('explains affordability and projections with assumptions and disclaimers', async () => {
    const afford = await ask(user, 'Can I afford a purchase of ₹50,000?');
    expect(afford.body.data.answer).toMatch(/^Yes/);
    expect(afford.body.data.assumptions.join(' ')).toMatch(/emergency buffer/);
    expect(afford.body.data.disclaimer).toMatch(/not financial advice/);
    const big = await ask(user, 'Can I afford a 1 crore flat?');
    expect(big.body.data.answer).not.toMatch(/^Yes/);
    const proj = await ask(user, 'What will my savings look like after six months?');
    expect(proj.body.data.intent).toBe('savings_projection');
    expect(proj.body.data.disclaimer).toMatch(/not guarantees/);
  });

  it('falls back to helpful examples', async () => {
    const res = await ask(user, 'tell me a joke');
    expect(res.body.data.intent).toBe('help');
    expect(res.body.data.followUps.length).toBeGreaterThanOrEqual(5);
  });
});
