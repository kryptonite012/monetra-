import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/format';

/** Displays a decimal-string amount; optional colouring for income (+) and spending (−). */
export function Money({ value, tone = 'none', compact, sign, className }: { value: string | number | null | undefined; tone?: 'none' | 'auto' | 'positive' | 'negative'; compact?: boolean; sign?: boolean; className?: string }) {
  const n = Number(value ?? 0);
  const color = tone === 'auto' ? (n > 0 ? 'text-positive' : n < 0 ? 'text-negative' : '') : tone === 'positive' ? 'text-positive' : tone === 'negative' ? 'text-negative' : '';
  return <span className={cn('num whitespace-nowrap', color, className)}>{formatMoney(value, { compact, sign })}</span>;
}
