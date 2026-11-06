# Financial Calculation Engine

All formulas live in `backend/src/engine/` as pure functions with no database
access, so each one can be tested on its own (`backend/tests/unit/engine.test.ts`).

## Number handling

- Money is never a JavaScript `number`. Calculations use `decimal.js`
  (40 significant digits) and values are stored as PostgreSQL `NUMERIC(19,4)`.
- Values are stored at 4 decimal places with banker's rounding (half-even).
  API responses show 2 decimal places, rounded half-up for display.
- Splitting an amount (`allocate`) hands the leftover paise to the first
  shares, so the shares always add up exactly to the original amount.

## Interest

| Function | Formula | Notes |
| --- | --- | --- |
| `simpleInterest(P, R, t)` | `I = P × R/100 × t` | `t` in years |
| `compoundInterest(P, R, t, n)` | `A = P × (1 + R/100/n)^(n×t)` | `n = 4` (quarterly) is the default because Indian FDs compound quarterly |
| `recurringDepositMaturity(R, rate, months)` | `M = Σ R × (1 + rate/400)^((months − i + 1)/3)` | Each instalment compounds quarterly for the months it stays deposited |
| `accruedValue(P, R, days)` | compound interest with `t = days/365` | Used to value an FD before it matures. Shown as **calculated**, never as a market price |

## Loans

| Function | Formula |
| --- | --- |
| `calculateEmi(P, R, n)` | `EMI = P × r × (1+r)^n / ((1+r)^n − 1)`, with `r = R/1200`. When `r = 0`, `EMI = P/n` |
| `calculateFlatEmi(P, R, n)` | `(P + P × R/100 × n/12) / n` |
| `amortizationSchedule` | Each month: `interest = round2(balance × r)`, `principal = EMI − interest`. The last instalment pays whatever balance is left, so the loan closes at exactly 0.00 |
| `tenureForEmi(P, R, E)` | `n = ⌈−ln(1 − rP/E) / ln(1 + r)⌉`, with a 0.001-month allowance for paise rounding |
| `prepaymentImpact` | Rebuilds the schedule after a part-prepayment. The borrower either keeps the EMI (shorter tenure) or keeps the tenure (lower EMI). Reports the interest saved |

Edge cases: a tenure of zero or less throws an error. An EMI that does not cover
the first month's interest throws an error. A prepayment of the full balance
closes the loan.

Due dates use an anchor day. A loan due on the 31st falls on 28/29 February
and returns to the 31st in March.

## Returns

| Function | Formula |
| --- | --- |
| `absoluteReturn(invested, current)` | `(current − invested) / invested × 100`. Returns null if nothing was invested |
| `cagr(start, end, years)` | `(end/start)^(1/years) − 1`. Returns null for non-positive values or periods shorter than one month |
| `xirr(flows)` | Finds `r` where `Σ CFᵢ / (1+r)^(daysᵢ/365) = 0`. Uses Newton–Raphson and falls back to bisection. Returns null unless there is at least one outflow and one inflow |

## Ratios

| Function | Formula |
| --- | --- |
| `savingsRate` | `(income − expenses) / income × 100`. Returns null without income |
| `debtToIncome` | `monthly EMIs / monthly income × 100` |
| `netWorth` | `assets − liabilities` |
| `budgetUtilization` | `spent / limit × 100` |
| `monthlyBurnRate` | `expenses / days × 365/12` |
| `runwayMonths` | `liquid assets / monthly expenses` |
| `creditUtilization` | `card outstanding / total card limits × 100` |

## Net worth (as used by the dashboard)

```
assets      = positive account balances (bank, cash, wallet; accounts marked "include in net worth")
            + investment current values (manual, delayed, live or calculated prices)
            + asset register current values (property, vehicles, gold, …)
liabilities = credit card / overdraft outstanding (negative balances)
            + outstanding principal of active loans
            + open liabilities register entries
net worth   = assets − liabilities
```

## Projections and forecasts

- `projectBalance` computes `Bₖ = Bₖ₋₁ × (1 + r/12) + C` month by month.
- `monthsToTarget` and `requiredMonthlyContribution` answer goal questions.
  The closed form is `C = (T − P(1+r)ⁿ) × r / ((1+r)ⁿ − 1)`.
- `linearForecast` fits an ordinary least-squares line through monthly totals.
  It returns a range (±1.645 × the residual standard error, about 90%) as well
  as the central estimate. **Forecasts are estimates from past data, not
  guarantees.** The assistant always says so.

## Financial health score (0–100)

| Component | Weight | Full marks when |
| --- | --- | --- |
| Savings rate | 25 | ≥ 20% of income saved |
| Emergency fund | 20 | Liquid balances ≥ 6 months of expenses |
| Debt-to-income | 20 | 0%. Falls linearly to 0 points at 50% |
| Budget adherence | 15 | Every budgeted category is within its limit |
| Net worth | 10 | Positive and ≥ one year of expenses |
| Credit utilisation | 10 | ≤ 30%. Falls to 0 points at 90% |

A component with no data gets neutral (half) marks and says so in its
explanation. The score is an educational indicator. It is not a credit score
and not financial advice.
