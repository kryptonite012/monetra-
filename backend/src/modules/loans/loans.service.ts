import type { Knex } from 'knex';
import { db, withTransaction, type Db } from '../../db/knex';
import { amortizationSchedule, calculateEmi, calculateFlatEmi, emiQuote, prepaymentImpact } from '../../engine';
import { addMonths, todayIn } from '../../lib/dates';
import { conflict, notFound, unprocessable } from '../../lib/errors';
import { dec, money, storage, sum } from '../../lib/money';
import { categoryBySlug } from '../categories/categories.service';
import { postTransaction } from '../transactions/ledger.service';

export interface LoanInput {
  name: string;
  loanType: string;
  lender: string;
  accountNumberLast4?: string | null;
  principal: string;
  interestRate: string;
  interestType: 'reducing' | 'flat';
  tenureMonths: number;
  startDate: string;
  firstEmiDate?: string;
  emiAmount?: string;
  processingFee?: string;
  repaymentAccountId?: string | null;
  disbursementAccountId?: string | null;
  paidInstallments?: number;
  notes?: string | null;
}

function installmentRows(userId: string, loanId: string, schedule: ReturnType<typeof amortizationSchedule>) {
  return schedule.map((s) => ({
    user_id: userId,
    loan_id: loanId,
    installment_no: s.installmentNo,
    due_date: s.dueDate,
    opening_principal: s.openingPrincipal,
    emi_amount: s.emi,
    principal_component: s.principal,
    interest_component: s.interest,
    closing_principal: s.closingPrincipal,
  }));
}

export async function createLoan(userId: string, input: LoanInput) {
  return withTransaction(async (trx) => {
    const firstEmiDate = input.firstEmiDate ?? addMonths(input.startDate, 1);
    const emi =
      input.emiAmount ??
      (input.interestType === 'flat' ? calculateFlatEmi(input.principal, input.interestRate, input.tenureMonths) : calculateEmi(input.principal, input.interestRate, input.tenureMonths)).toFixed(2);
    let schedule;
    try {
      schedule = amortizationSchedule({ principal: input.principal, annualRatePct: input.interestRate, months: input.tenureMonths, firstDueDate: firstEmiDate, emi, interestType: input.interestType });
    } catch (err) {
      throw unprocessable((err as Error).message, { field: 'emiAmount' });
    }
    const [loan] = await trx('loans')
      .insert({
        user_id: userId,
        name: input.name,
        loan_type: input.loanType,
        lender: input.lender,
        account_number_last4: input.accountNumberLast4 ?? null,
        principal: storage(input.principal),
        interest_rate: input.interestRate,
        interest_type: input.interestType,
        tenure_months: input.tenureMonths,
        start_date: input.startDate,
        first_emi_date: firstEmiDate,
        emi_amount: storage(emi),
        processing_fee: storage(input.processingFee ?? 0),
        repayment_account_id: input.repaymentAccountId ?? null,
        notes: input.notes ?? null,
      })
      .returning('*');
    await trx('loan_installments').insert(installmentRows(userId, loan.id, schedule));

    // Loans that started before they were added: mark historical instalments as paid (no ledger entries).
    if (input.paidInstallments) {
      if (input.paidInstallments > schedule.length) throw unprocessable('Paid instalments exceed the tenure');
      await trx('loan_installments')
        .where({ loan_id: loan.id })
        .where('installment_no', '<=', input.paidInstallments)
        .update({ status: 'paid', paid_amount: trx.ref('emi_amount'), paid_on: trx.ref('due_date') });
    }

    if (input.disbursementAccountId) {
      const net = dec(input.principal).minus(input.processingFee ?? 0);
      const txn = await postTransaction(
        {
          userId,
          accountId: input.disbursementAccountId,
          kind: 'loan_disbursement',
          amount: storage(net),
          occurredOn: input.startDate,
          description: `${input.name} disbursed by ${input.lender}`,
          notes: dec(input.processingFee ?? 0).gt(0) ? `Net of processing fee ${money(input.processingFee)}` : null,
          autoCategorize: false,
          metadata: { loanId: loan.id },
        },
        trx,
      );
      await trx('loans').where({ id: loan.id }).update({ disbursement_transaction_id: txn.id });
    }
    return loan.id as string;
  });
}

/** Loan with derived outstanding balance, progress and next instalment. */
export async function loanDetails(userId: string, loanId: string, conn: Db = db) {
  const loan = await conn('loans').where({ id: loanId, user_id: userId }).first();
  if (!loan) throw notFound('Loan');
  const installments: Array<Record<string, any>> = await conn('loan_installments').where({ loan_id: loanId }).orderBy('installment_no');
  return decorateLoan(loan, installments);
}

export function decorateLoan(loan: Record<string, any>, installments: Array<Record<string, any>>) {
  const settled = installments.filter((i) => i.status === 'paid' || i.status === 'prepayment');
  const due = installments.filter((i) => i.status === 'due');
  const principalRepaid = sum(settled.map((i) => i.principalComponent));
  const outstanding = loan.status === 'active' ? dec(loan.principal).minus(principalRepaid) : dec(0);
  const interestPaid = sum(settled.map((i) => i.interestComponent));
  const interestRemaining = sum(due.map((i) => i.interestComponent));
  const today = todayIn();
  const next = due[0] ?? null;
  return {
    ...loan,
    principal: money(loan.principal),
    emiAmount: money(loan.emiAmount),
    outstandingPrincipal: money(outstanding),
    principalRepaid: money(principalRepaid),
    interestPaid: money(interestPaid),
    interestRemaining: money(interestRemaining),
    totalPayable: money(sum(installments.filter((i) => i.status !== 'cancelled').map((i) => i.emiAmount))),
    installmentsPaid: settled.filter((i) => i.status === 'paid').length,
    installmentsRemaining: due.length,
    overdueCount: due.filter((i) => i.dueDate < today).length,
    progressPercent: dec(loan.principal).isZero() ? '0.00' : principalRepaid.div(loan.principal).times(100).toFixed(2),
    nextInstallment: next ? { installmentNo: next.installmentNo, dueDate: next.dueDate, emiAmount: money(next.emiAmount), overdue: next.dueDate < today } : null,
    projectedClosureDate: due.at(-1)?.dueDate ?? loan.closedOn ?? null,
    schedule: installments.map((i) => ({
      ...i,
      openingPrincipal: money(i.openingPrincipal),
      emiAmount: money(i.emiAmount),
      principalComponent: money(i.principalComponent),
      interestComponent: money(i.interestComponent),
      closingPrincipal: money(i.closingPrincipal),
      paidAmount: i.paidAmount != null ? money(i.paidAmount) : null,
    })),
  };
}

export async function listLoans(userId: string, includeClosed = false) {
  const q = db('loans').where({ user_id: userId }).orderBy([{ column: 'status' }, { column: 'start_date', order: 'desc' }]);
  if (!includeClosed) q.where({ status: 'active' });
  const loans = await q;
  if (!loans.length) return [];
  const installments: Array<Record<string, any>> = await db('loan_installments').whereIn('loan_id', loans.map((l: any) => l.id)).orderBy('installment_no');
  return loans.map((l: any) => {
    const { schedule: _schedule, ...rest } = decorateLoan(l, installments.filter((i) => i.loanId === l.id));
    return rest;
  });
}

async function postRepayment(userId: string, loan: Record<string, any>, accountId: string, amount: string, paidOn: string, description: string, trx: Knex.Transaction) {
  return postTransaction(
    {
      userId,
      accountId,
      kind: 'loan_repayment',
      amount,
      occurredOn: paidOn,
      description,
      categoryId: await categoryBySlug('financial.emi', trx),
      counterparty: loan.lender,
      autoCategorize: false,
      allowDuplicate: true,
      metadata: { loanId: loan.id },
    },
    trx,
  );
}

/** Pays the next due instalment (instalments are settled in order). */
export async function payInstallment(userId: string, loanId: string, installmentNo: number, input: { accountId?: string | null; paidOn: string; amount?: string }) {
  return withTransaction(async (trx) => {
    const loan = await trx('loans').where({ id: loanId, user_id: userId }).forUpdate().first();
    if (!loan) throw notFound('Loan');
    if (loan.status !== 'active') throw conflict('This loan is closed');
    const inst = await trx('loan_installments').where({ loan_id: loanId, installment_no: installmentNo }).first();
    if (!inst) throw notFound('Instalment');
    if (inst.status !== 'due') throw conflict('This instalment is already settled');
    const earlier = await trx('loan_installments').where({ loan_id: loanId, status: 'due' }).where('installment_no', '<', installmentNo).first('installment_no');
    if (earlier) throw conflict(`Pay instalment #${earlier.installmentNo} first`);
    const accountId = input.accountId ?? loan.repaymentAccountId;
    if (!accountId) throw unprocessable('Choose the account the EMI was paid from', { field: 'accountId' });
    const amount = input.amount ?? inst.emiAmount;
    const txn = await postRepayment(userId, loan, accountId, amount, input.paidOn, `EMI #${installmentNo} – ${loan.name}`, trx);
    await trx('loan_installments').where({ id: inst.id }).update({ status: 'paid', paid_amount: storage(amount), paid_on: input.paidOn, transaction_id: txn.id });
    const remaining = await trx('loan_installments').where({ loan_id: loanId, status: 'due' }).first('id');
    if (!remaining) await trx('loans').where({ id: loanId }).update({ status: 'closed', closed_on: input.paidOn });
    return { transactionId: txn.id, warnings: txn.warnings };
  });
}

/** Part-prepayment: records the payment and rebuilds the unpaid schedule. */
export async function prepayLoan(userId: string, loanId: string, input: { amount: string; paidOn: string; accountId: string; strategy: 'reduce_tenure' | 'reduce_emi' }) {
  return withTransaction(async (trx) => {
    const loan = await trx('loans').where({ id: loanId, user_id: userId }).forUpdate().first();
    if (!loan) throw notFound('Loan');
    if (loan.status !== 'active') throw conflict('This loan is closed');
    if (loan.interestType !== 'reducing') throw unprocessable('Prepayment modelling is available for reducing-balance loans');
    const all: Array<Record<string, any>> = await trx('loan_installments').where({ loan_id: loanId }).orderBy('installment_no');
    const due = all.filter((i) => i.status === 'due');
    if (!due.length) throw conflict('No instalments remain');
    const outstanding = dec(loan.principal).minus(sum(all.filter((i) => i.status !== 'due' && i.status !== 'cancelled').map((i) => i.principalComponent)));
    if (dec(input.amount).gt(outstanding)) throw unprocessable(`Prepayment exceeds the outstanding principal of ${money(outstanding)}`);

    const impact = prepaymentImpact({ outstanding, annualRatePct: loan.interestRate, emi: loan.emiAmount, remainingMonths: due.length, prepayment: input.amount, strategy: input.strategy });
    const txn = await postRepayment(userId, loan, input.accountId, input.amount, input.paidOn, `Prepayment – ${loan.name}`, trx);

    const lastSettledNo = all.filter((i) => i.status !== 'due').reduce((m, i) => Math.max(m, i.installmentNo), 0);
    await trx('loan_installments').where({ loan_id: loanId, status: 'due' }).delete();
    await trx('loan_installments').insert({
      user_id: userId,
      loan_id: loanId,
      installment_no: lastSettledNo + 1,
      due_date: input.paidOn,
      opening_principal: storage(outstanding),
      emi_amount: storage(input.amount),
      principal_component: storage(input.amount),
      interest_component: '0',
      closing_principal: storage(outstanding.minus(input.amount)),
      status: 'prepayment',
      paid_amount: storage(input.amount),
      paid_on: input.paidOn,
      transaction_id: txn.id,
    });
    const newOutstanding = outstanding.minus(input.amount);
    if (newOutstanding.isZero()) {
      await trx('loans').where({ id: loanId }).update({ status: 'closed', closed_on: input.paidOn });
    } else {
      const schedule = amortizationSchedule({
        principal: newOutstanding,
        annualRatePct: loan.interestRate,
        months: impact.newTenureMonths,
        firstDueDate: due[0].dueDate,
        emi: impact.newEmi,
        startNo: lastSettledNo + 2,
      });
      await trx('loan_installments').insert(installmentRows(userId, loanId, schedule));
      await trx('loans').where({ id: loanId }).update({ emi_amount: impact.newEmi, tenure_months: lastSettledNo + 1 + schedule.length });
    }
    return { transactionId: txn.id, impact };
  });
}

/** Foreclosure: pays off the loan in full; remaining instalments are cancelled. */
export async function forecloseLoan(userId: string, loanId: string, input: { accountId: string; paidOn: string; amount: string }) {
  return withTransaction(async (trx) => {
    const loan = await trx('loans').where({ id: loanId, user_id: userId }).forUpdate().first();
    if (!loan) throw notFound('Loan');
    if (loan.status !== 'active') throw conflict('This loan is already closed');
    const txn = await postRepayment(userId, loan, input.accountId, input.amount, input.paidOn, `Foreclosure – ${loan.name}`, trx);
    await trx('loan_installments').where({ loan_id: loanId, status: 'due' }).update({ status: 'cancelled' });
    await trx('loans').where({ id: loanId }).update({ status: 'foreclosed', closed_on: input.paidOn });
    return { transactionId: txn.id };
  });
}

/** Liability dashboard: loans, card dues and other liabilities in one place. */
export async function liabilitySummary(userId: string) {
  const loans = await listLoans(userId);
  const [cards] = await db('accounts as a')
    .join('account_current_balances as b', 'b.account_id', 'a.id')
    .where({ 'a.user_id': userId, 'a.is_active': true })
    .whereIn('a.type', ['credit_card', 'overdraft'])
    .select(db.raw('COALESCE(SUM(CASE WHEN b.balance < 0 THEN -b.balance ELSE 0 END), 0) AS outstanding'), db.raw('COALESCE(SUM(a.credit_limit), 0) AS total_limit'));
  const [others] = await db('liabilities').where({ user_id: userId, status: 'open' }).select(db.raw('COALESCE(SUM(amount_outstanding), 0) AS total'));
  const loanOutstanding = sum(loans.map((l: any) => l.outstandingPrincipal));
  const monthlyEmi = sum(loans.map((l: any) => l.emiAmount));
  const upcoming = loans
    .filter((l: any) => l.nextInstallment)
    .map((l: any) => ({ loanId: l.id, name: l.name, lender: l.lender, ...l.nextInstallment }))
    .sort((a: any, b: any) => a.dueDate.localeCompare(b.dueDate));
  return {
    totalOutstanding: money(loanOutstanding.plus(cards.outstanding).plus(others.total)),
    loans: { count: loans.length, outstanding: money(loanOutstanding), monthlyEmi: money(monthlyEmi), interestRemaining: money(sum(loans.map((l: any) => l.interestRemaining))) },
    creditCards: { outstanding: money(cards.outstanding), totalLimit: money(cards.totalLimit) },
    otherLiabilities: money(others.total),
    upcomingEmis: upcoming,
    byType: Object.values(
      loans.reduce((acc: Record<string, { loanType: string; outstanding: string; count: number }>, l: any) => {
        const e = (acc[l.loanType] ??= { loanType: l.loanType, outstanding: '0.00', count: 0 });
        e.outstanding = money(dec(e.outstanding).plus(l.outstandingPrincipal));
        e.count += 1;
        return acc;
      }, {}),
    ),
  };
}

export { emiQuote };
