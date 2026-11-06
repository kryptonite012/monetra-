import { D, dec, type Dec, type MoneyInput } from '../lib/money';

/** Savings rate % = (income − expenses) / income × 100. Null when there is no income. */
export function savingsRate(income: MoneyInput, expenses: MoneyInput): Dec | null {
  const i = dec(income);
  if (i.lte(0)) return null;
  return i.minus(dec(expenses)).div(i).times(100);
}

/** Debt-to-income % = monthly debt payments (EMIs + card dues) / gross monthly income × 100. */
export function debtToIncome(monthlyDebtPayments: MoneyInput, monthlyIncome: MoneyInput): Dec | null {
  const i = dec(monthlyIncome);
  if (i.lte(0)) return null;
  return dec(monthlyDebtPayments).div(i).times(100);
}

/** Net worth = total assets − total liabilities. */
export function netWorth(assets: MoneyInput, liabilities: MoneyInput): Dec {
  return dec(assets).minus(dec(liabilities));
}

/** Budget utilisation % = spent / limit × 100 (null without a positive limit). */
export function budgetUtilization(spent: MoneyInput, limit: MoneyInput): Dec | null {
  const l = dec(limit);
  if (l.lte(0)) return null;
  return dec(spent).div(l).times(100);
}

/** Monthly burn rate = expenses over a window ÷ days × (365 / 12). */
export function monthlyBurnRate(expenses: MoneyInput, days: number): Dec {
  if (days <= 0) throw new RangeError('days must be positive');
  return dec(expenses).div(days).times(new D(365).div(12));
}

/** Months of expenses covered by liquid savings (runway / emergency-fund coverage). */
export function runwayMonths(liquidAssets: MoneyInput, monthlyExpenses: MoneyInput): Dec | null {
  const m = dec(monthlyExpenses);
  if (m.lte(0)) return null;
  return dec(liquidAssets).div(m);
}

/** Credit utilisation % across cards = outstanding / total limit × 100. */
export function creditUtilization(outstanding: MoneyInput, totalLimit: MoneyInput): Dec | null {
  const l = dec(totalLimit);
  if (l.lte(0)) return null;
  return dec(outstanding).div(l).times(100);
}
