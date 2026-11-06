import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createUser, type TestUser } from '../helpers/api';
import { resetDatabase } from '../helpers/db';
import { balanceOf, createAccount } from '../helpers/fixtures';

describe('loans and EMIs', () => {
  let user: TestUser;
  let bank: { id: string };
  let loanId: string;

  beforeAll(async () => {
    await resetDatabase();
    user = await createUser();
    bank = await createAccount(user, { name: 'Bank', openingBalance: '300000', openingDate: '2025-01-01' });
  });
  afterAll(resetDatabase);

  it('quotes EMIs without saving anything', async () => {
    const res = await api().post('/api/v1/loans/calculator').set(user.auth).send({ principal: '500000', interestRate: '10.5', tenureMonths: 60, firstEmiDate: '2026-01-05' });
    expect(res.body.data).toMatchObject({ emi: '10746.95', totalInterest: '144816.99' });
    expect(res.body.data.schedule).toHaveLength(60);
  });

  it('creates a loan with schedule and disbursement', async () => {
    const res = await api()
      .post('/api/v1/loans')
      .set(user.auth)
      .send({ name: 'Car loan', loanType: 'vehicle', lender: 'HDFC Bank', principal: '500000', interestRate: '10.5', tenureMonths: 60, startDate: '2026-01-01', firstEmiDate: '2026-02-05', processingFee: '2500', disbursementAccountId: bank.id, repaymentAccountId: bank.id });
    expect(res.status).toBe(201);
    loanId = res.body.data.id;
    expect(res.body.data).toMatchObject({ emiAmount: '10746.95', outstandingPrincipal: '500000.00', installmentsRemaining: 60, interestRemaining: '144816.99' });
    expect(res.body.data.nextInstallment).toMatchObject({ installmentNo: 1, dueDate: '2026-02-05' });
    expect(await balanceOf(user, bank.id)).toBe('797500.00');
  });

  it('pays EMIs in order and tracks principal repaid', async () => {
    const outOfOrder = await api().post(`/api/v1/loans/${loanId}/installments/2/pay`).set(user.auth).send({ paidOn: '2026-02-05' });
    expect(outOfOrder.status).toBe(409);
    const ok = await api().post(`/api/v1/loans/${loanId}/installments/1/pay`).set(user.auth).send({ paidOn: '2026-02-05' });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ outstandingPrincipal: '493628.05', principalRepaid: '6371.95', interestPaid: '4375.00', installmentsPaid: 1 });
    expect(await balanceOf(user, bank.id)).toBe('786753.05');
    expect((await api().post(`/api/v1/loans/${loanId}/installments/1/pay`).set(user.auth).send({})).status).toBe(409);
  });

  it('re-plans the schedule after a prepayment', async () => {
    const res = await api().post(`/api/v1/loans/${loanId}/prepay`).set(user.auth).send({ amount: '100000', paidOn: '2026-02-20', accountId: bank.id, strategy: 'reduce_tenure' });
    expect(res.status).toBe(200);
    expect(Number(res.body.data.impact.interestSaved)).toBeGreaterThan(0);
    expect(res.body.data.loan.outstandingPrincipal).toBe('393628.05');
    expect(res.body.data.loan.installmentsRemaining).toBeLessThan(59);
    const sched = res.body.data.loan.schedule;
    expect(sched.at(-1).closingPrincipal).toBe('0.00');
    expect(sched.find((s: { status: string }) => s.status === 'prepayment').principalComponent).toBe('100000.00');
  });

  it('summarises liabilities including card dues', async () => {
    const card = await createAccount(user, { name: 'Card', type: 'credit_card', openingBalance: '-8000', creditLimit: '50000' });
    void card;
    const res = await api().get('/api/v1/loans/summary').set(user.auth);
    expect(res.body.data.loans).toMatchObject({ count: 1, outstanding: '393628.05', monthlyEmi: '10746.95' });
    expect(res.body.data.creditCards.outstanding).toBe('8000.00');
    expect(res.body.data.totalOutstanding).toBe('401628.05');
    expect(res.body.data.upcomingEmis[0].installmentNo).toBe(3);
  });

  it('marks historical instalments for older loans and supports foreclosure', async () => {
    const res = await api()
      .post('/api/v1/loans')
      .set(user.auth)
      .send({ name: 'Education loan', loanType: 'education', lender: 'SBI', principal: '240000', interestRate: '0', tenureMonths: 24, startDate: '2025-01-01', paidInstallments: 12 });
    expect(res.body.data).toMatchObject({ outstandingPrincipal: '120000.00', installmentsPaid: 12, emiAmount: '10000.00' });
    const closed = await api().post(`/api/v1/loans/${res.body.data.id}/foreclose`).set(user.auth).send({ amount: '120000', paidOn: '2026-03-01', accountId: bank.id });
    expect(closed.body.data).toMatchObject({ status: 'foreclosed', outstandingPrincipal: '0.00', installmentsRemaining: 0 });
    expect((await api().delete(`/api/v1/loans/${res.body.data.id}`).set(user.auth)).status).toBe(409);
  });
});
