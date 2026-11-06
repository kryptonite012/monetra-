import { db } from '../../db/knex';
import { notFound } from '../../lib/errors';
import { dec, money, sum } from '../../lib/money';
import { accountStatement } from '../accounts/reconciliation.service';
import { categoryBreakdown, cashflowSeries, flowTotals } from '../dashboard/dashboard.service';
import { incomeSummary } from '../income/income.service';
import { portfolio } from '../investments/investments.service';
import { listLoans, loanDetails } from '../loans/loans.service';
import { computeNetWorth, netWorthHistory } from '../networth/networth.service';
import type { ReportDocument, ReportSection } from './report.types';

export type ReportType =
  | 'monthly_statement' | 'annual_report' | 'income_expense' | 'account_statement' | 'tax_summary' | 'loan_statement' | 'investment_report' | 'net_worth';

export const REPORT_TITLES: Record<ReportType, string> = {
  monthly_statement: 'Monthly Financial Statement',
  annual_report: 'Annual Financial Report',
  income_expense: 'Income vs Expenditure',
  account_statement: 'Account Statement',
  tax_summary: 'Tax Summary',
  loan_statement: 'Loan Statement',
  investment_report: 'Investment Report',
  net_worth: 'Net Worth Statement',
};

export interface ReportParams {
  userId: string;
  type: ReportType;
  from: string;
  to: string;
  accountId?: string;
  loanId?: string;
}

const DISCLAIMER = 'Generated from records you entered in Monetra. Figures are not audited and are not tax or investment advice.';

async function transactionSection(userId: string, from: string, to: string): Promise<ReportSection> {
  const rows = await db('transactions as t')
    .join('accounts as a', 'a.id', 't.account_id')
    .leftJoin('transaction_categories as c', 'c.id', 't.category_id')
    .where('t.user_id', userId)
    .where('t.status', 'posted')
    .whereNot('t.kind', 'reversal')
    .whereBetween('t.occurred_on', [from, to])
    .orderBy([{ column: 't.occurred_on' }, { column: 't.posted_at' }])
    .select('t.occurred_on', 't.description', 'a.name as account', 'c.name as category', 't.kind', 't.direction', 't.amount', 't.reference');
  return {
    title: 'Transactions',
    columns: [
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'description', label: 'Description', type: 'text' },
      { key: 'account', label: 'Account', type: 'text' },
      { key: 'category', label: 'Category', type: 'text' },
      { key: 'type', label: 'Type', type: 'text' },
      { key: 'credit', label: 'Credit', type: 'money' },
      { key: 'debit', label: 'Debit', type: 'money' },
      { key: 'reference', label: 'Reference', type: 'text' },
    ],
    rows: rows.map((r: any) => ({
      date: r.occurredOn,
      description: r.description,
      account: r.account,
      category: r.category ?? '',
      type: r.kind.replace(/_/g, ' '),
      credit: r.direction === 'credit' ? money(r.amount) : '',
      debit: r.direction === 'debit' ? money(r.amount) : '',
      reference: r.reference ?? '',
    })),
  };
}

function categorySection(rows: Array<Record<string, any>>): ReportSection {
  return {
    title: 'Spending by category',
    columns: [
      { key: 'name', label: 'Category', type: 'text' },
      { key: 'total', label: 'Amount', type: 'money' },
      { key: 'percent', label: 'Share %', type: 'percent' },
    ],
    rows,
  };
}

export async function buildReport(p: ReportParams): Promise<ReportDocument> {
  const owner = await db('user_profiles as pr').join('users as u', 'u.id', 'pr.user_id').where('u.id', p.userId).first('pr.full_name', 'u.email');
  const base = {
    title: REPORT_TITLES[p.type],
    subtitle: `${owner?.fullName ?? ''} · ${p.from} to ${p.to}`,
    period: { from: p.from, to: p.to },
    generatedAt: new Date().toISOString(),
    owner: owner?.fullName ?? owner?.email ?? '',
    notes: [DISCLAIMER],
  };

  switch (p.type) {
    case 'monthly_statement':
    case 'income_expense': {
      const flows = await flowTotals(p.userId, p.from, p.to);
      const cats = await categoryBreakdown(p.userId, p.from, p.to);
      const sections: ReportSection[] = [categorySection(cats)];
      if (p.type === 'monthly_statement') sections.push(await transactionSection(p.userId, p.from, p.to));
      else {
        const { rows } = await db.raw(
          `SELECT to_char(date_trunc('month', occurred_on), 'YYYY-MM') AS month,
                  COALESCE(SUM(amount) FILTER (WHERE kind IN ('income','interest')), 0) AS income,
                  COALESCE(SUM(amount) FILTER (WHERE kind IN ('expense','bill_payment','fee','loan_repayment')), 0) AS expenses
             FROM transactions WHERE user_id = ? AND status = 'posted' AND occurred_on BETWEEN ? AND ? GROUP BY 1 ORDER BY 1`,
          [p.userId, p.from, p.to],
        );
        sections.unshift({
          title: 'Monthly income vs expenditure',
          columns: [
            { key: 'month', label: 'Month', type: 'text' },
            { key: 'income', label: 'Income', type: 'money' },
            { key: 'expenses', label: 'Expenditure', type: 'money' },
            { key: 'net', label: 'Net', type: 'money' },
          ],
          rows: rows.map((r: any) => ({ month: r.month, income: money(r.income), expenses: money(r.expenses), net: money(dec(r.income).minus(r.expenses)) })),
        });
      }
      return {
        ...base,
        summary: [
          { label: 'Total income', value: money(flows.income), type: 'money' },
          { label: 'Total expenditure', value: money(flows.expenses), type: 'money' },
          { label: 'Net cash flow', value: money(flows.income.minus(flows.expenses)), type: 'money' },
          { label: 'Savings rate', value: flows.income.gt(0) ? flows.income.minus(flows.expenses).div(flows.income).times(100).toFixed(2) : '0.00', type: 'percent' },
        ],
        sections,
      };
    }
    case 'annual_report': {
      const flows = await flowTotals(p.userId, p.from, p.to);
      const series = await cashflowSeries(p.userId, 12);
      const cats = await categoryBreakdown(p.userId, p.from, p.to);
      const nw = await computeNetWorth(p.userId);
      return {
        ...base,
        summary: [
          { label: 'Total income', value: money(flows.income), type: 'money' },
          { label: 'Total expenditure', value: money(flows.expenses), type: 'money' },
          { label: 'Net savings', value: money(flows.income.minus(flows.expenses)), type: 'money' },
          { label: 'Net worth today', value: nw.netWorth, type: 'money' },
        ],
        sections: [
          {
            title: 'Month by month',
            columns: [
              { key: 'month', label: 'Month', type: 'text' },
              { key: 'income', label: 'Income', type: 'money' },
              { key: 'expenses', label: 'Expenditure', type: 'money' },
              { key: 'net', label: 'Net', type: 'money' },
            ],
            rows: series,
          },
          categorySection(cats),
        ],
      };
    }
    case 'account_statement': {
      if (!p.accountId) throw notFound('Account');
      const st = await accountStatement(p.userId, p.accountId, p.from, p.to);
      return {
        ...base,
        title: `Account Statement – ${st.account.name}`,
        summary: [
          { label: 'Opening balance', value: st.openingBalance, type: 'money' },
          { label: 'Total credits', value: st.totalCredits, type: 'money' },
          { label: 'Total debits', value: st.totalDebits, type: 'money' },
          { label: 'Closing balance', value: st.closingBalance, type: 'money' },
        ],
        sections: [
          {
            title: 'Entries',
            columns: [
              { key: 'occurredOn', label: 'Date', type: 'date' },
              { key: 'description', label: 'Description', type: 'text' },
              { key: 'reference', label: 'Reference', type: 'text' },
              { key: 'credit', label: 'Credit', type: 'money' },
              { key: 'debit', label: 'Debit', type: 'money' },
              { key: 'runningBalance', label: 'Balance', type: 'money' },
            ],
            rows: st.entries.map((e: any) => ({ ...e, reference: e.reference ?? '', credit: e.direction === 'credit' ? e.amount : '', debit: e.direction === 'debit' ? e.amount : '' })),
          },
        ],
      };
    }
    case 'tax_summary': {
      const income = await incomeSummary(p.userId, p.from, p.to);
      const deductions = await db('expense_records as e')
        .join('transactions as t', 't.id', 'e.transaction_id')
        .where('e.user_id', p.userId)
        .whereNull('e.deleted_at')
        .where('e.is_tax_deductible', true)
        .whereBetween('t.occurred_on', [p.from, p.to])
        .groupBy('e.tax_section')
        .select(db.raw(`COALESCE(e.tax_section, 'unspecified') AS section`), db.raw('SUM(t.amount) AS total'), db.raw('COUNT(*)::int AS count'));
      const gst = await db('expense_records as e')
        .join('transactions as t', 't.id', 'e.transaction_id')
        .where('e.user_id', p.userId)
        .whereNull('e.deleted_at')
        .whereBetween('t.occurred_on', [p.from, p.to])
        .sum({ total: 'e.gst_amount' })
        .first();
      const [realized] = await db('investment_transactions').where({ user_id: p.userId }).whereBetween('trade_date', [p.from, p.to]).where('type', 'sell').select(db.raw('COALESCE(SUM(realized_gain), 0) AS total'));
      return {
        ...base,
        summary: [
          { label: 'Gross income', value: income.totals.gross, type: 'money' },
          { label: 'Tax deducted at source (TDS)', value: income.totals.taxDeducted, type: 'money' },
          { label: 'Deductible expenses recorded', value: money(sum(deductions.map((d: any) => d.total))), type: 'money' },
          { label: 'Realised capital gains', value: money(realized.total), type: 'money' },
          { label: 'GST paid on recorded expenses', value: money(gst?.total ?? 0), type: 'money' },
        ],
        sections: [
          {
            title: 'Income by source',
            columns: [
              { key: 'sourceType', label: 'Source', type: 'text' },
              { key: 'gross', label: 'Gross', type: 'money' },
              { key: 'taxDeducted', label: 'TDS', type: 'money' },
              { key: 'net', label: 'Net received', type: 'money' },
            ],
            rows: income.bySource,
          },
          {
            title: 'Deductions by section',
            columns: [
              { key: 'section', label: 'Section', type: 'text' },
              { key: 'count', label: 'Entries', type: 'number' },
              { key: 'total', label: 'Amount', type: 'money' },
            ],
            rows: deductions.map((d: any) => ({ ...d, total: money(d.total) })),
          },
        ],
        notes: [DISCLAIMER, 'Use this summary to prepare your return; verify limits (e.g. 80C ₹1.5 lakh) and the regime you choose with a tax professional.'],
      };
    }
    case 'loan_statement': {
      const loans = p.loanId ? [await loanDetails(p.userId, p.loanId)] : await Promise.all((await listLoans(p.userId, true)).map((l: any) => loanDetails(p.userId, l.id)));
      return {
        ...base,
        summary: [
          { label: 'Loans', value: String(loans.length) },
          { label: 'Outstanding principal', value: money(sum(loans.map((l: any) => l.outstandingPrincipal))), type: 'money' },
          { label: 'Interest paid', value: money(sum(loans.map((l: any) => l.interestPaid))), type: 'money' },
          { label: 'Interest remaining', value: money(sum(loans.map((l: any) => l.interestRemaining))), type: 'money' },
        ],
        sections: loans.map((l: any) => ({
          title: `${l.name} – ${l.lender} (${l.status})`,
          columns: [
            { key: 'installmentNo', label: '#', type: 'number' },
            { key: 'dueDate', label: 'Due date', type: 'date' },
            { key: 'emiAmount', label: 'EMI', type: 'money' },
            { key: 'principalComponent', label: 'Principal', type: 'money' },
            { key: 'interestComponent', label: 'Interest', type: 'money' },
            { key: 'closingPrincipal', label: 'Balance', type: 'money' },
            { key: 'status', label: 'Status', type: 'text' },
          ],
          rows: l.schedule.filter((s: any) => s.dueDate >= p.from && s.dueDate <= p.to),
        })),
      };
    }
    case 'investment_report': {
      const pf = await portfolio(p.userId);
      return {
        ...base,
        summary: [
          { label: 'Invested', value: pf.totals.invested, type: 'money' },
          { label: 'Current value', value: pf.totals.currentValue, type: 'money' },
          { label: 'Unrealised gain', value: pf.totals.unrealizedGain, type: 'money' },
          { label: 'Realised gain', value: pf.totals.realizedGain, type: 'money' },
          { label: 'XIRR %', value: pf.totals.xirrPercent ?? 'n/a', type: 'percent' },
        ],
        sections: [
          {
            title: 'Holdings',
            columns: [
              { key: 'name', label: 'Holding', type: 'text' },
              { key: 'instrumentType', label: 'Type', type: 'text' },
              { key: 'units', label: 'Units', type: 'number' },
              { key: 'investedAmount', label: 'Invested', type: 'money' },
              { key: 'currentValue', label: 'Current value', type: 'money' },
              { key: 'unrealizedGain', label: 'Gain', type: 'money' },
              { key: 'valuationLabel', label: 'Price source', type: 'text' },
            ],
            rows: pf.holdingsList,
          },
          {
            title: 'Allocation',
            columns: [
              { key: 'instrumentType', label: 'Type', type: 'text' },
              { key: 'value', label: 'Value', type: 'money' },
              { key: 'percent', label: 'Share %', type: 'percent' },
            ],
            rows: pf.allocation,
          },
        ],
        notes: [DISCLAIMER, pf.disclaimer],
      };
    }
    case 'net_worth': {
      const nw = await computeNetWorth(p.userId);
      const history = await netWorthHistory(p.userId, 12);
      return {
        ...base,
        summary: [
          { label: 'Total assets', value: nw.totalAssets, type: 'money' },
          { label: 'Total liabilities', value: nw.totalLiabilities, type: 'money' },
          { label: 'Net worth', value: nw.netWorth, type: 'money' },
        ],
        sections: [
          {
            title: 'Composition',
            columns: [
              { key: 'label', label: 'Item', type: 'text' },
              { key: 'side', label: 'Side', type: 'text' },
              { key: 'value', label: 'Value', type: 'money' },
            ],
            rows: nw.composition,
          },
          {
            title: 'Trend',
            columns: [
              { key: 'month', label: 'Month', type: 'text' },
              { key: 'totalAssets', label: 'Assets', type: 'money' },
              { key: 'totalLiabilities', label: 'Liabilities', type: 'money' },
              { key: 'netWorth', label: 'Net worth', type: 'money' },
            ],
            rows: history.points,
          },
        ],
        notes: [DISCLAIMER, nw.valuationNote],
      };
    }
  }
}
