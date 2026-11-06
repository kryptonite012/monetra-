import { z } from 'zod';
import { db } from '../../db/knex';
import { amortizationSchedule } from '../../engine';
import { todayIn } from '../../lib/dates';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { apiRouter, idParams, isoDate, optionalText, queryBool } from '../../lib/http';
import { nonNegativeMoney, positiveMoney, rateSchema } from '../../lib/money';
import { requireOwnedRef } from '../../lib/ownership';
import { guarded } from '../../lib/sensitive';
import { audit } from '../audit/audit.service';
import { createLoan, emiQuote, forecloseLoan, liabilitySummary, listLoans, loanDetails, payInstallment, prepayLoan } from './loans.service';

const r = apiRouter('/loans', 'Loans & EMIs');

const LOAN_TYPES = ['personal', 'education', 'home', 'vehicle', 'gold', 'business', 'consumer_durable', 'credit_card_emi', 'other'] as const;

r.get('/', {
  summary: 'List loans with outstanding balances and next EMI',
  query: z.object({ includeClosed: queryBool.optional() }),
  handler: ({ user, query }) => listLoans(user.id, query.includeClosed),
});

r.get('/summary', {
  summary: 'Outstanding liability dashboard (loans, card dues, other liabilities)',
  handler: ({ user }) => liabilitySummary(user.id),
});

r.post('/calculator', {
  summary: 'EMI calculator with full amortisation schedule',
  body: z.object({ principal: positiveMoney, interestRate: rateSchema, tenureMonths: z.number().int().min(1).max(480), firstEmiDate: isoDate.optional() }),
  handler: ({ body }) => ({
    ...emiQuote(body.principal, body.interestRate, body.tenureMonths),
    schedule: amortizationSchedule({ principal: body.principal, annualRatePct: body.interestRate, months: body.tenureMonths, firstDueDate: body.firstEmiDate ?? todayIn() }),
  }),
});

r.post('/', {
  summary: 'Add a loan; the EMI schedule is generated automatically',
  status: 201,
  body: guarded(
    z.object({
      name: z.string().trim().min(2).max(80),
      loanType: z.enum(LOAN_TYPES),
      lender: z.string().trim().min(2).max(120),
      accountNumberLast4: z.string().regex(/^\d{4}$/).nullish(),
      principal: positiveMoney,
      interestRate: rateSchema,
      interestType: z.enum(['reducing', 'flat']).default('reducing'),
      tenureMonths: z.number().int().min(1).max(480),
      startDate: isoDate,
      firstEmiDate: isoDate.optional(),
      emiAmount: positiveMoney.optional(),
      processingFee: nonNegativeMoney.default('0'),
      repaymentAccountId: z.uuid().nullish(),
      disbursementAccountId: z.uuid().nullish(),
      paidInstallments: z.number().int().min(0).max(480).default(0),
      notes: optionalText(1000),
    }),
  ),
  handler: async ({ user, body, req }) => {
    await requireOwnedRef('accounts', body.repaymentAccountId, user.id, 'repaymentAccountId');
    if (body.firstEmiDate && body.firstEmiDate < body.startDate) throw badRequest('First EMI date must be on or after the start date');
    const id = await createLoan(user.id, body);
    await audit({ action: 'loan.created', req, entityType: 'loan', entityId: id, metadata: { principal: body.principal } });
    return loanDetails(user.id, id);
  },
});

r.get('/:id', {
  summary: 'Loan details with amortisation schedule',
  params: idParams,
  handler: ({ user, params }) => loanDetails(user.id, params.id),
});

r.patch('/:id', {
  summary: 'Update loan details (financial terms are fixed; use prepayment or foreclosure)',
  params: idParams,
  body: z.object({ name: z.string().trim().min(2).max(80), lender: z.string().trim().min(2).max(120), repaymentAccountId: z.uuid().nullable(), notes: optionalText(1000) }).partial(),
  handler: async ({ user, params, body }) => {
    await requireOwnedRef('accounts', body.repaymentAccountId, user.id, 'repaymentAccountId');
    const patch = Object.fromEntries(Object.entries({ name: body.name, lender: body.lender, repayment_account_id: body.repaymentAccountId, notes: body.notes }).filter(([, v]) => v !== undefined));
    const [row] = await db('loans').where({ id: params.id, user_id: user.id }).update(patch).returning('id');
    if (!row) throw notFound('Loan');
    return loanDetails(user.id, params.id);
  },
});

r.post('/:id/installments/:no/pay', {
  summary: 'Record an EMI payment (posts a ledger debit)',
  params: z.object({ id: z.uuid(), no: z.coerce.number().int().min(1) }),
  body: z.object({ accountId: z.uuid().nullish(), paidOn: isoDate.default(() => todayIn()), amount: positiveMoney.optional() }),
  handler: async ({ user, params, body, req }) => {
    const result = await payInstallment(user.id, params.id, params.no, body);
    await audit({ action: 'loan.emi_paid', req, entityType: 'loan', entityId: params.id, metadata: { installmentNo: params.no } });
    return { ...(await loanDetails(user.id, params.id)), warnings: result.warnings };
  },
});

r.post('/:id/prepay', {
  summary: 'Make a part-prepayment and re-plan the remaining schedule',
  params: idParams,
  body: z.object({ amount: positiveMoney, paidOn: isoDate.default(() => todayIn()), accountId: z.uuid(), strategy: z.enum(['reduce_tenure', 'reduce_emi']).default('reduce_tenure') }),
  handler: async ({ user, params, body, req }) => {
    const result = await prepayLoan(user.id, params.id, body);
    await audit({ action: 'loan.prepaid', req, entityType: 'loan', entityId: params.id, metadata: { amount: body.amount, strategy: body.strategy } });
    return { impact: result.impact, loan: await loanDetails(user.id, params.id) };
  },
});

r.post('/:id/foreclose', {
  summary: 'Close a loan early with a final payment',
  params: idParams,
  body: z.object({ amount: positiveMoney, paidOn: isoDate.default(() => todayIn()), accountId: z.uuid() }),
  handler: async ({ user, params, body, req }) => {
    await forecloseLoan(user.id, params.id, body);
    await audit({ action: 'loan.foreclosed', req, entityType: 'loan', entityId: params.id, metadata: { amount: body.amount } });
    return loanDetails(user.id, params.id);
  },
});

r.delete('/:id', {
  summary: 'Delete a loan that has no recorded payments',
  params: idParams,
  handler: async ({ user, params, req }) => {
    const loan = await db('loans').where({ id: params.id, user_id: user.id }).first();
    if (!loan) throw notFound('Loan');
    const ledger = await db('transactions').where({ user_id: user.id }).whereRaw(`metadata->>'loanId' = ?`, [params.id]).first('id');
    if (ledger) throw conflict('This loan has ledger entries; foreclose or close it instead');
    await db('loans').where({ id: params.id }).delete();
    await audit({ action: 'loan.deleted', req, entityType: 'loan', entityId: params.id });
    return undefined;
  },
});

export default r.router;
