import { addDays, addMonths, monthEnd, monthStart, todayIn } from '../../lib/dates';

/**
 * Lightweight, deterministic natural-language parsing for the assistant.
 * Everything here is rule-based so that answers are reproducible and every
 * number can be traced back to the user's own records.
 */
export interface Period {
  from: string;
  to: string;
  label: string;
}

const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

export function parsePeriod(q: string, today = todayIn(), fallback: 'month' | 'year' = 'month'): Period {
  const s = q.toLowerCase();
  const year = Number(today.slice(0, 4));
  if (/\btoday\b/.test(s)) return { from: today, to: today, label: 'today' };
  if (/\byesterday\b/.test(s)) {
    const y = addDays(today, -1);
    return { from: y, to: y, label: 'yesterday' };
  }
  if (/\bthis week\b/.test(s)) return { from: addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7)), to: today, label: 'this week' };
  if (/\blast week\b/.test(s)) {
    const start = addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7) - 7);
    return { from: start, to: addDays(start, 6), label: 'last week' };
  }
  const lastN = s.match(/\b(?:last|past|previous)\s+(\d{1,2})\s+months?\b/);
  if (lastN) return { from: monthStart(addMonths(today, -Number(lastN[1]))), to: addDays(monthStart(today), -1), label: `the last ${lastN[1]} months` };
  if (/\blast month\b|\bprevious month\b/.test(s)) {
    const start = monthStart(addMonths(today, -1));
    return { from: start, to: monthEnd(start), label: 'last month' };
  }
  if (/\bthis year\b|\bso far this year\b|\bytd\b/.test(s)) return { from: `${year}-01-01`, to: today, label: 'this year' };
  if (/\blast year\b/.test(s)) return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31`, label: `${year - 1}` };
  for (let i = 0; i < 12; i++) {
    const m = s.match(new RegExp(`\\b(?:in\\s+)?(${MONTH_NAMES[i]}|${MONTH_NAMES[i].slice(0, 3)})\\b(?:\\s+(\\d{4}))?`));
    if (m && !(MONTH_NAMES[i] === 'may' && !/\bin may\b|\bmay \d{4}\b/.test(s))) {
      let y = m[2] ? Number(m[2]) : year;
      if (!m[2] && `${y}-${String(i + 1).padStart(2, '0')}` > today.slice(0, 7)) y -= 1;
      const start = `${y}-${String(i + 1).padStart(2, '0')}-01`;
      return { from: start, to: monthEnd(start), label: `${MONTH_NAMES[i][0].toUpperCase()}${MONTH_NAMES[i].slice(1)} ${y}` };
    }
  }
  if (fallback === 'year') return { from: `${year}-01-01`, to: today, label: 'this year' };
  return { from: monthStart(today), to: today, label: 'this month' };
}

/** Parses Indian-style amounts: ₹50,000 · 50000 · 50k · 1.5 lakh · 2 crore. */
export function parseAmount(q: string): string | null {
  const s = q.toLowerCase().replace(/rs\.?|inr|₹/g, ' ');
  const m = s.match(/(\d+(?:,\d{2,3})*(?:\.\d+)?)\s*(k|thousand|lakh|lakhs|lac|lacs|l|crore|crores|cr)?\b/);
  if (!m) return null;
  const base = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(base) || base <= 0) return null;
  const unit = m[2] ?? '';
  const mult = /^(k|thousand)$/.test(unit) ? 1e3 : /^(lakh|lakhs|lac|lacs|l)$/.test(unit) ? 1e5 : /^(crore|crores|cr)$/.test(unit) ? 1e7 : 1;
  return (base * mult).toFixed(2);
}

export function parseMonthsAhead(q: string, fallback = 6): number {
  const m = q.toLowerCase().match(/(\d{1,2})\s*(months?|years?)/);
  if (!m) return fallback;
  const n = Number(m[1]);
  return Math.min(m[2].startsWith('year') ? n * 12 : n, 60);
}

export type Intent =
  | 'where_money_went' | 'savings' | 'top_category' | 'emi_remaining' | 'affordability' | 'savings_projection'
  | 'net_worth' | 'spend_on' | 'income' | 'upcoming_bills' | 'budget_status' | 'unusual' | 'subscriptions'
  | 'health_score' | 'balance' | 'help';

const RULES: Array<[Intent, RegExp]> = [
  ['affordability', /\b(afford|can i (buy|spend|purchase)|should i buy)\b/],
  ['savings_projection', /\b(savings?|balance|wealth).*(look like|be|in|after)\b.*\b\d+\s*(months?|years?)\b|\bproject(ion|ed)?\b|\bforecast\b/],
  ['emi_remaining', /\b(emi|loan|loans|debt|owe|outstanding)\b/],
  ['where_money_went', /\b(where did (my|the) money go|where.*money.*(go|went)|breakdown|what did i spend on)\b/],
  ['top_category', /\b(which|what|top|biggest|largest|most)\b.*\b(category|categories)\b|\bconsumes? (the )?most\b/],
  ['savings', /\bhow much (did|have) i save|\b(savings rate|saved)\b/],
  ['net_worth', /\bnet ?worth\b|\bhow (rich|wealthy)\b/],
  ['upcoming_bills', /\b(bills?|due|renewals?|upcoming payments?)\b/],
  ['budget_status', /\bbudget/],
  ['unusual', /\b(unusual|suspicious|strange|odd|anomal)/],
  ['subscriptions', /\bsubscriptions?\b|\bott\b/],
  ['health_score', /\b(health|score|how am i doing|financial health)\b/],
  ['income', /\b(income|earn|earned|salary|made)\b/],
  ['balance', /\b(balance|how much (money|cash) do i have|bank balance)\b/],
  ['spend_on', /\b(spend|spent|spending|expense|expenses|cost)\b/],
];

export function detectIntent(question: string): Intent {
  const s = question.toLowerCase();
  for (const [intent, re] of RULES) if (re.test(s)) return intent;
  return 'help';
}

/** Extracts the subject of "how much did I spend on X". */
export function spendTarget(question: string): string | null {
  const m = question.toLowerCase().match(/\b(?:on|at|for)\s+([a-z][a-z0-9 &'.-]{1,40}?)(?:\s+(?:this|last|in|during|so|today|yesterday|past|previous)\b|[?.!]|$)/);
  return m ? m[1].trim() : null;
}
