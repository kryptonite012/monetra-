import { db } from '../../db/knex';
import { addDays } from '../../lib/dates';
import { D, dec, formatINR, money } from '../../lib/money';

export interface Anomaly {
  transactionId: string;
  occurredOn: string;
  description: string;
  amount: string;
  categoryName: string | null;
  baselineMedian: string;
  ratio: string;
  reason: string;
}

const MIN_AMOUNT = new D(2000);

function median(values: InstanceType<typeof D>[]): InstanceType<typeof D> {
  if (!values.length) return new D(0);
  const sorted = [...values].sort((a, b) => a.cmp(b));
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : sorted[mid - 1].plus(sorted[mid]).div(2);
}

const normalise = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, ' ').trim();

/**
 * Flags spending that is unusually large for the user. An expense is an
 * anomaly when it is at least ₹2,000 and at least 3× the median of the
 * previous 90 days of spending in the same category (or across all spending
 * when the category has fewer than 2 past entries). Payments that recur at a
 * similar amount (same merchant or description, within 25%), such as rent,
 * are never flagged.
 */
export async function detectAnomalies(userId: string, from: string, to: string): Promise<Anomaly[]> {
  const candidates: Array<Record<string, any>> = await db('transactions as t')
    .leftJoin('transaction_categories as c', 'c.id', 't.category_id')
    .where('t.user_id', userId)
    .where('t.status', 'posted')
    .whereIn('t.kind', ['expense', 'bill_payment'])
    .whereBetween('t.occurred_on', [from, to])
    .where('t.amount', '>=', MIN_AMOUNT.toString())
    .select('t.id', 't.occurred_on', 't.description', 't.amount', 't.category_id', 't.merchant_id', 'c.name as category_name');
  if (!candidates.length) return [];

  const historyFrom = addDays(from, -90);
  const history: Array<Record<string, any>> = await db('transactions')
    .where({ user_id: userId, status: 'posted' })
    .whereIn('kind', ['expense', 'bill_payment'])
    .where('occurred_on', '>=', historyFrom)
    .where('occurred_on', '<', from)
    .select('amount', 'category_id', 'merchant_id', 'description');
  const overall = median(history.map((h) => dec(h.amount)));

  const out: Anomaly[] = [];
  for (const c of candidates) {
    const amount = dec(c.amount);
    const recurring = history.some(
      (h) =>
        ((c.merchantId && h.merchantId === c.merchantId) || normalise(h.description) === normalise(c.description)) &&
        dec(h.amount).minus(amount).abs().lte(amount.times(0.25)),
    );
    if (recurring) continue;
    const sameCat = history.filter((h) => h.categoryId === c.categoryId).map((h) => dec(h.amount));
    const useCategory = sameCat.length >= 2;
    const baseline = useCategory ? median(sameCat) : overall;
    if (history.length < 5 || baseline.lte(0)) continue;
    const ratio = amount.div(baseline);
    if (ratio.gte(3)) {
      out.push({
        transactionId: c.id,
        occurredOn: c.occurredOn,
        description: c.description,
        amount: money(c.amount),
        categoryName: c.categoryName,
        baselineMedian: money(baseline),
        ratio: ratio.toFixed(1),
        reason: `${ratio.toFixed(1)}× your typical ${useCategory ? `${c.categoryName ?? 'category'} spend` : 'expense'} of ${formatINR(baseline)}`,
      });
    }
  }
  return out.sort((a, b) => Number(b.ratio) - Number(a.ratio));
}
