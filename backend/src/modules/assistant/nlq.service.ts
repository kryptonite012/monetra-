import { db } from '../../db/knex';
import { addMonths, monthStart, todayIn } from '../../lib/dates';
import { D, dec, formatINR, money, percent } from '../../lib/money';
import { accountsSummary } from '../accounts/accounts.service';
import { budgetUtilization } from '../budgets/budgets.service';
import { subscriptionSummary, upcomingPayments } from '../bills/bills.service';
import { categoryBreakdown, flowTotals, healthScore } from '../dashboard/dashboard.service';
import { liabilitySummary } from '../loans/loans.service';
import { computeNetWorth } from '../networth/networth.service';
import { detectAnomalies } from './anomaly';
import { FORECAST_DISCLAIMER, monthsOfSurplus, savingsForecast } from './insights.service';
import { detectIntent, parseAmount, parseMonthsAhead, parsePeriod, spendTarget, type Intent } from './nlq.parser';

export interface AssistantAnswer {
  question: string;
  intent: Intent;
  answer: string;
  facts: Array<{ label: string; value: string }>;
  assumptions: string[];
  confidence: 'high' | 'medium' | 'low';
  period?: { from: string; to: string; label: string };
  data?: unknown;
  followUps: string[];
  disclaimer?: string;
  source: string;
}

const EXAMPLES = [
  'Where did my money go this month?',
  'How much did I save this year?',
  'Which category consumes most of my income?',
  'How much EMI do I have remaining?',
  'Can I afford a purchase of ₹50,000?',
  'What will my savings look like after six months?',
];

const SOURCE = 'Calculated from your Monetra records by the built-in rules engine.';

function base(question: string, intent: Intent): Omit<AssistantAnswer, 'answer'> {
  return { question, intent, facts: [], assumptions: [], confidence: 'high', followUps: [], source: SOURCE };
}

export async function answerQuestion(userId: string, rawQuestion: string): Promise<AssistantAnswer> {
  const question = rawQuestion.trim().replace(/\bsix\b/i, '6').replace(/\btwelve\b/i, '12').replace(/\bthree\b/i, '3');
  const intent = detectIntent(question);
  const b = base(rawQuestion, intent);

  switch (intent) {
    case 'where_money_went': {
      const period = parsePeriod(question);
      const cats = await categoryBreakdown(userId, period.from, period.to);
      const flows = await flowTotals(userId, period.from, period.to);
      if (!cats.length) return { ...b, period, answer: `I couldn't find any spending recorded for ${period.label}.`, confidence: 'medium', followUps: ['How much did I earn this month?'] };
      const top = cats.slice(0, 5);
      const merchants = await db('transactions as t')
        .join('merchants as m', 'm.id', 't.merchant_id')
        .where({ 't.user_id': userId, 't.status': 'posted' })
        .whereIn('t.kind', ['expense', 'bill_payment'])
        .whereBetween('t.occurred_on', [period.from, period.to])
        .groupBy('m.name')
        .select('m.name', db.raw('SUM(t.amount) AS total'))
        .orderBy('total', 'desc')
        .limit(3);
      return {
        ...b,
        period,
        answer: `You spent ${formatINR(flows.expenses)} ${period.label}. The biggest share went to ${top.map((c) => `${c.name} (${formatINR(c.total)}, ${c.percent}%)`).join(', ')}.${merchants.length ? ` Top merchants: ${merchants.map((m: any) => `${m.name} ${formatINR(m.total)}`).join(', ')}.` : ''}`,
        facts: top.map((c) => ({ label: c.name, value: formatINR(c.total) })),
        data: { categories: cats, merchants: merchants.map((m: any) => ({ ...m, total: money(m.total) })) },
        followUps: ['Which category consumes most of my income?', 'Any unusual transactions this month?'],
      };
    }
    case 'savings': {
      const period = parsePeriod(question, todayIn(), /\bmonth\b/.test(question.toLowerCase()) ? 'month' : 'year');
      const flows = await flowTotals(userId, period.from, period.to);
      const saved = flows.income.minus(flows.expenses);
      const rate = flows.income.gt(0) ? saved.div(flows.income).times(100).toFixed(1) : null;
      return {
        ...b,
        period,
        answer: flows.income.isZero()
          ? `No income is recorded for ${period.label}, so I can't work out your savings yet. Expenses were ${formatINR(flows.expenses)}.`
          : `${saved.gte(0) ? 'You saved' : 'You overspent by'} ${formatINR(saved.abs())} ${period.label}: income ${formatINR(flows.income)} minus spending ${formatINR(flows.expenses)}${rate ? `, a savings rate of ${rate}%` : ''}.`,
        facts: [
          { label: 'Income', value: formatINR(flows.income) },
          { label: 'Spending', value: formatINR(flows.expenses) },
          { label: 'Saved', value: formatINR(saved) },
        ],
        assumptions: ['Savings = recorded income − recorded spending (expenses, bills, fees and EMIs). Transfers between your own accounts are excluded.'],
        followUps: ['What will my savings look like after 6 months?'],
      };
    }
    case 'top_category': {
      const period = parsePeriod(question);
      const cats = await categoryBreakdown(userId, period.from, period.to);
      const flows = await flowTotals(userId, period.from, period.to);
      if (!cats.length) return { ...b, period, answer: `There is no spending recorded for ${period.label}.`, confidence: 'medium' };
      const top = cats[0];
      const ofIncome = flows.income.gt(0) ? percent(top.total, flows.income) : null;
      return {
        ...b,
        period,
        answer: `${top.name} consumes the most: ${formatINR(top.total)} ${period.label}, which is ${top.percent}% of your spending${ofIncome ? ` and ${ofIncome}% of your income` : ''}.${cats[1] ? ` Next is ${cats[1].name} at ${formatINR(cats[1].total)}.` : ''}`,
        facts: cats.slice(0, 3).map((c) => ({ label: c.name, value: `${formatINR(c.total)} (${c.percent}%)` })),
        followUps: [`How much did I spend on ${top.name.toLowerCase()} last month?`],
      };
    }
    case 'emi_remaining': {
      const l = await liabilitySummary(userId);
      if (!l.loans.count && dec(l.creditCards.outstanding).isZero()) return { ...b, answer: 'You have no active loans or card dues recorded. 🎉', followUps: ['What is my net worth?'] };
      const loans = (await db('loans').where({ user_id: userId, status: 'active' }).select('id')).length;
      const rows = await db('loan_installments as i').join('loans as lo', 'lo.id', 'i.loan_id').where({ 'i.user_id': userId, 'i.status': 'due', 'lo.status': 'active' }).select(db.raw('COUNT(*)::int AS count'), db.raw('COALESCE(SUM(i.emi_amount), 0) AS total'));
      return {
        ...b,
        answer: `You have ${loans} active loan${loans === 1 ? '' : 's'} with ${formatINR(l.loans.outstanding)} principal outstanding. Your EMIs total ${formatINR(l.loans.monthlyEmi)} a month, with ${rows[0].count} instalments (${formatINR(rows[0].total)}, including ${formatINR(l.loans.interestRemaining)} interest) still to pay.${dec(l.creditCards.outstanding).gt(0) ? ` Credit cards add ${formatINR(l.creditCards.outstanding)} outstanding.` : ''}`,
        facts: [
          { label: 'Monthly EMI', value: formatINR(l.loans.monthlyEmi) },
          { label: 'Principal outstanding', value: formatINR(l.loans.outstanding) },
          { label: 'Remaining EMI payments', value: formatINR(rows[0].total) },
          { label: 'Card dues', value: formatINR(l.creditCards.outstanding) },
        ],
        data: l,
        followUps: ['Can I afford a purchase of ₹50,000?'],
      };
    }
    case 'affordability': {
      const amount = parseAmount(question);
      if (!amount) return { ...b, answer: 'How much is the purchase? Try “Can I afford ₹50,000?”', confidence: 'low', followUps: ['Can I afford a purchase of ₹50,000?'] };
      const accounts = await accountsSummary(userId);
      const today = todayIn();
      const from = monthStart(addMonths(today, -3));
      const flows = await flowTotals(userId, from, today);
      const monthlyExpenses = flows.expenses.div(3);
      const surplus = flows.income.minus(flows.expenses).div(3);
      const liquid = dec(accounts.totalAvailableBalance);
      const buffer = monthlyExpenses.times(3);
      const afterPurchase = liquid.minus(amount);
      let verdict: string;
      let confidence: AssistantAnswer['confidence'] = 'medium';
      if (afterPurchase.gte(buffer)) {
        verdict = `Yes, ${formatINR(amount)} looks affordable. After paying it you'd still have ${formatINR(afterPurchase)} in bank, cash and wallets, above a 3-month emergency buffer of ${formatINR(buffer)}.`;
      } else if (surplus.gt(0)) {
        const months = monthsOfSurplus(amount, surplus.toFixed(2));
        verdict = `Paying ${formatINR(amount)} now would leave ${formatINR(afterPurchase)}, below a 3-month emergency buffer of ${formatINR(buffer)}. Saving your average surplus of ${formatINR(surplus)} a month, you could fund it in about ${months} month${months === 1 ? '' : 's'} without touching the buffer.`;
      } else {
        verdict = `It would be risky: paying ${formatINR(amount)} would leave ${formatINR(afterPurchase)}, and your recent spending has been higher than your income. Consider waiting or reducing costs first.`;
        confidence = 'medium';
      }
      return {
        ...b,
        answer: verdict,
        confidence,
        facts: [
          { label: 'Liquid balance', value: formatINR(liquid) },
          { label: 'Avg monthly spending', value: formatINR(monthlyExpenses) },
          { label: 'Avg monthly surplus', value: formatINR(surplus) },
          { label: 'Emergency buffer (3 months)', value: formatINR(buffer) },
        ],
        assumptions: [
          'Uses the last 3 months of recorded income and spending as your typical month.',
          'Keeps 3 months of expenses aside as an emergency buffer.',
          'Investments, credit limits and upcoming one-off income are not counted as available cash.',
        ],
        disclaimer: 'This is a guideline from your records, not financial advice.',
        followUps: ['What will my savings look like after 6 months?'],
      };
    }
    case 'savings_projection': {
      const months = parseMonthsAhead(question, 6);
      const f = await savingsForecast(userId, months);
      const end = f.projection.at(-1);
      return {
        ...b,
        answer: `If your recent pattern continues, your liquid savings could be about ${formatINR(end?.balance ?? f.startingBalance)} after ${months} months (from ${formatINR(f.startingBalance)} today, with an average monthly surplus of ${formatINR(f.averageMonthlySurplus)}).`,
        confidence: 'medium',
        facts: f.projection.filter((_, i) => i % Math.max(1, Math.floor(months / 4)) === 0 || i === months - 1).map((p) => ({ label: p.month, value: formatINR(p.balance) })),
        assumptions: f.assumptions,
        data: f,
        disclaimer: FORECAST_DISCLAIMER,
        followUps: ['How much did I save this year?'],
      };
    }
    case 'net_worth': {
      const nw = await computeNetWorth(userId);
      return {
        ...b,
        answer: `Your net worth is ${formatINR(nw.netWorth)}: assets of ${formatINR(nw.totalAssets)} minus liabilities of ${formatINR(nw.totalLiabilities)}.`,
        facts: nw.composition.filter((c) => dec(c.value).gt(0)).map((c) => ({ label: c.label, value: formatINR(c.value) })),
        assumptions: [nw.valuationNote],
        data: nw,
      };
    }
    case 'income': {
      const period = parsePeriod(question);
      const flows = await flowTotals(userId, period.from, period.to);
      const bySource = await db('income_records as i')
        .join('transactions as t', 't.id', 'i.transaction_id')
        .where('i.user_id', userId)
        .whereNull('i.deleted_at')
        .whereBetween('t.occurred_on', [period.from, period.to])
        .groupBy('i.source_type')
        .select('i.source_type', db.raw('SUM(i.net_amount) AS total'))
        .orderBy('total', 'desc');
      return {
        ...b,
        period,
        answer: `You received ${formatINR(flows.income)} ${period.label}${bySource.length ? `, mostly from ${bySource.map((s: any) => `${s.sourceType.replace('_', ' ')} (${formatINR(s.total)})`).join(', ')}` : ''}.`,
        facts: bySource.map((s: any) => ({ label: s.sourceType, value: formatINR(s.total) })),
      };
    }
    case 'spend_on': {
      const period = parsePeriod(question);
      const target = spendTarget(question);
      if (!target) {
        const flows = await flowTotals(userId, period.from, period.to);
        return { ...b, period, answer: `You spent ${formatINR(flows.expenses)} ${period.label}.`, followUps: ['Where did my money go this month?'] };
      }
      const like = `%${target.replace(/[%_\\]/g, '')}%`;
      const rows = await db('transactions as t')
        .leftJoin('transaction_categories as c', 'c.id', 't.category_id')
        .leftJoin('transaction_categories as pc', 'pc.id', 'c.parent_id')
        .leftJoin('merchants as m', 'm.id', 't.merchant_id')
        .where({ 't.user_id': userId, 't.status': 'posted' })
        .whereIn('t.kind', ['expense', 'bill_payment', 'fee'])
        .whereBetween('t.occurred_on', [period.from, period.to])
        .where((q) => q.whereILike('c.name', like).orWhereILike('pc.name', like).orWhereILike('m.name', like).orWhereILike('t.description', like))
        .select(db.raw('COALESCE(SUM(t.amount), 0) AS total'), db.raw('COUNT(*)::int AS count'));
      const total = rows[0].total;
      return {
        ...b,
        period,
        answer: rows[0].count ? `You spent ${formatINR(total)} on ${target} ${period.label} across ${rows[0].count} transaction${rows[0].count === 1 ? '' : 's'}.` : `I found no spending matching “${target}” ${period.label}.`,
        confidence: rows[0].count ? 'high' : 'medium',
        facts: [{ label: target, value: formatINR(total) }],
        assumptions: [`Matched “${target}” against category names, merchants and descriptions.`],
      };
    }
    case 'upcoming_bills': {
      const up = await upcomingPayments(userId, 30);
      return {
        ...b,
        answer: up.items.length
          ? `You have ${up.items.length} payment${up.items.length === 1 ? '' : 's'} due in the next 30 days, about ${formatINR(up.totalExpected)} in total${up.overdueCount ? `, including ${up.overdueCount} overdue` : ''}: ${up.items.slice(0, 5).map((i) => `${i.name} on ${i.dueDate}${i.amount ? ` (${formatINR(i.amount)})` : ''}`).join('; ')}.`
          : 'Nothing is due in the next 30 days.',
        facts: up.items.slice(0, 6).map((i) => ({ label: `${i.name} · ${i.dueDate}`, value: i.amount ? formatINR(i.amount) : 'variable' })),
        data: up,
      };
    }
    case 'budget_status': {
      const budget = await db('budgets').where({ user_id: userId, month: monthStart(todayIn()) }).first('id');
      if (!budget) return { ...b, answer: "You haven't set a budget for this month yet. Create one from the Budgets page to track limits.", confidence: 'high' };
      const r = await budgetUtilization(userId, budget.id);
      const over = r.categories.filter((c) => c.status === 'exceeded');
      return {
        ...b,
        answer: `You've used ${r.totals.utilizationPercent}% of this month's ${formatINR(r.totals.limit)} budget (${formatINR(r.totals.spent)} spent).${over.length ? ` Over budget: ${over.map((c) => c.name).join(', ')}.` : ' All categories are within their limits.'}`,
        facts: r.categories.map((c) => ({ label: c.name, value: `${c.utilizationPercent}% of ${formatINR(c.limit)}` })),
      };
    }
    case 'unusual': {
      const period = parsePeriod(question);
      const items = await detectAnomalies(userId, period.from, period.to);
      return {
        ...b,
        period,
        answer: items.length ? `I found ${items.length} unusually large expense${items.length === 1 ? '' : 's'} ${period.label}: ${items.slice(0, 3).map((a) => `${a.description} (${formatINR(a.amount)}, ${a.reason})`).join('; ')}.` : `Nothing looks unusual ${period.label}.`,
        assumptions: ['An expense is flagged when it is at least ₹2,000 and 3× your typical spend in that category over the previous 90 days.'],
        data: items,
      };
    }
    case 'subscriptions': {
      const s = await subscriptionSummary(userId);
      return {
        ...b,
        answer: `You have ${s.activeCount} active subscription${s.activeCount === 1 ? '' : 's'} costing ${formatINR(s.monthlyCost)} a month (${formatINR(s.yearlyCost)} a year).${s.possiblyUnused.length ? ` You may not be using ${s.possiblyUnused.map((u) => u.name).join(', ')}; cancelling could save ${formatINR(s.potentialMonthlySavings)} a month.` : ''}`,
        facts: [{ label: 'Monthly cost', value: formatINR(s.monthlyCost) }, { label: 'Yearly cost', value: formatINR(s.yearlyCost) }],
        data: s,
      };
    }
    case 'health_score': {
      const h = await healthScore(userId);
      return {
        ...b,
        answer: `Your financial health score is ${h.score}/100 (${h.grade}).${h.focusArea ? ` The biggest opportunity is ${h.focusArea.label.toLowerCase()}: ${h.focusArea.explanation}` : ''}`,
        facts: h.components.map((c) => ({ label: c.label, value: `${c.score}/${c.max}${c.value ? ` · ${c.value}` : ''}` })),
        assumptions: [h.methodology],
        data: h,
      };
    }
    case 'balance': {
      const a = await accountsSummary(userId);
      return {
        ...b,
        answer: `You have ${formatINR(a.totalAvailableBalance)} across your bank, cash and wallet accounts${dec(a.creditCardOutstanding).gt(0) ? `, with ${formatINR(a.creditCardOutstanding)} owed on credit cards` : ''}.`,
        facts: Object.entries(a.byType).map(([type, v]) => ({ label: type, value: formatINR(v.balance) })),
        assumptions: ['Balances are computed from the transactions you have recorded; Monetra is not connected to your bank.'],
      };
    }
    default:
      return {
        ...b,
        answer: "I can answer questions about the finances you've recorded in Monetra. Try one of these:",
        confidence: 'low',
        followUps: EXAMPLES,
      };
  }
}

export { EXAMPLES, D };
