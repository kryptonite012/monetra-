import { cn } from '@/lib/cn';

export function Progress({ value, tone = 'brand', className }: { value: number; tone?: 'brand' | 'positive' | 'warning' | 'negative'; className?: string }) {
  const colors = { brand: 'bg-brand', positive: 'bg-positive', warning: 'bg-warning', negative: 'bg-negative' };
  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full bg-surface-3', className)} role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn('h-full rounded-full transition-all duration-500', colors[tone])} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}
