import { dec, type MoneyInput } from '../lib/money';

export interface HealthInputs {
  monthlyIncome: MoneyInput;
  monthlyExpenses: MoneyInput;
  liquidAssets: MoneyInput;
  monthlyDebtPayments: MoneyInput;
  netWorth: MoneyInput;
  /** Share of budgeted categories within limit (0-100); null when no budget exists. */
  budgetAdherencePct?: number | null;
  /** Credit card utilisation %; null when there are no cards. */
  creditUtilizationPct?: number | null;
}

export interface HealthComponent {
  key: string;
  label: string;
  score: number;
  max: number;
  value: string | null;
  explanation: string;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Financial health score (0-100) built from six transparent components.
 * Weights: savings rate 25, emergency fund 20, debt-to-income 20,
 * budget adherence 15, net worth 10, credit utilisation 10.
 * Components without data are scored neutrally (half marks) and flagged.
 */
export function financialHealthScore(input: HealthInputs) {
  const income = dec(input.monthlyIncome);
  const expenses = dec(input.monthlyExpenses);
  const components: HealthComponent[] = [];

  // 1. Savings rate: 20%+ earns full marks.
  if (income.gt(0)) {
    const rate = income.minus(expenses).div(income).times(100).toNumber();
    components.push({ key: 'savings_rate', label: 'Savings rate', max: 25, score: Math.round(clamp(rate / 20, 0, 1) * 25), value: `${rate.toFixed(1)}%`, explanation: 'Share of monthly income you keep. 20% or more earns full marks.' });
  } else {
    components.push({ key: 'savings_rate', label: 'Savings rate', max: 25, score: 0, value: null, explanation: 'No income recorded for the period.' });
  }

  // 2. Emergency fund: 6 months of expenses earns full marks.
  if (expenses.gt(0)) {
    const months = dec(input.liquidAssets).div(expenses).toNumber();
    components.push({ key: 'emergency_fund', label: 'Emergency fund', max: 20, score: Math.round(clamp(months / 6, 0, 1) * 20), value: `${months.toFixed(1)} months`, explanation: 'Months of expenses covered by bank, cash and wallet balances. Six months earns full marks.' });
  } else {
    components.push({ key: 'emergency_fund', label: 'Emergency fund', max: 20, score: 10, value: null, explanation: 'Not enough expense history yet; scored neutrally.' });
  }

  // 3. Debt-to-income: 0% full marks, falling to zero at 50%.
  if (income.gt(0)) {
    const dti = dec(input.monthlyDebtPayments).div(income).times(100).toNumber();
    components.push({ key: 'debt_to_income', label: 'Debt-to-income', max: 20, score: Math.round(clamp(1 - dti / 50, 0, 1) * 20), value: `${dti.toFixed(1)}%`, explanation: 'Monthly EMIs as a share of income. Lenders generally prefer below 40%; 0% earns full marks.' });
  } else {
    components.push({ key: 'debt_to_income', label: 'Debt-to-income', max: 20, score: dec(input.monthlyDebtPayments).gt(0) ? 0 : 10, value: null, explanation: 'No income recorded to compare against debt payments.' });
  }

  // 4. Budget adherence.
  if (input.budgetAdherencePct != null) {
    components.push({ key: 'budget_adherence', label: 'Budget adherence', max: 15, score: Math.round(clamp(input.budgetAdherencePct / 100, 0, 1) * 15), value: `${input.budgetAdherencePct.toFixed(0)}%`, explanation: 'Share of budgeted categories that stayed within their limits this month.' });
  } else {
    components.push({ key: 'budget_adherence', label: 'Budget adherence', max: 15, score: 7, value: null, explanation: 'No budget set for this month; scored neutrally. Create one to improve accuracy.' });
  }

  // 5. Net worth: positive net worth relative to a year of expenses.
  const nw = dec(input.netWorth);
  const annualExpenses = expenses.times(12);
  const nwScore = nw.lte(0) ? 0 : annualExpenses.gt(0) ? clamp(nw.div(annualExpenses).toNumber(), 0, 1) : 1;
  components.push({ key: 'net_worth', label: 'Net worth', max: 10, score: Math.round(nwScore * 10), value: nw.toFixed(2), explanation: 'Positive net worth equal to at least one year of expenses earns full marks.' });

  // 6. Credit utilisation: below 30% full marks, zero at 90%+.
  if (input.creditUtilizationPct != null) {
    const u = input.creditUtilizationPct;
    components.push({ key: 'credit_utilization', label: 'Credit utilisation', max: 10, score: Math.round((u <= 30 ? 1 : clamp(1 - (u - 30) / 60, 0, 1)) * 10), value: `${u.toFixed(1)}%`, explanation: 'Card balances as a share of credit limits. Under 30% earns full marks.' });
  } else {
    components.push({ key: 'credit_utilization', label: 'Credit utilisation', max: 10, score: 10, value: null, explanation: 'No credit cards with outstanding balances.' });
  }

  const score = components.reduce((s, c) => s + c.score, 0);
  const grade = score >= 80 ? 'Excellent' : score >= 65 ? 'Good' : score >= 45 ? 'Fair' : 'Needs attention';
  const weakest = [...components].sort((a, b) => a.score / a.max - b.score / b.max)[0];
  return {
    score,
    grade,
    components,
    focusArea: weakest ? { key: weakest.key, label: weakest.label, explanation: weakest.explanation } : null,
    methodology: 'Rule-based score from your recorded data. It is an educational indicator, not a credit score or financial advice.',
  };
}
