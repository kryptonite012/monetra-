import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Card } from './card';

export function StatCard({ label, value, hint, icon, tone = 'brand', className }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; tone?: 'brand' | 'positive' | 'negative' | 'accent' | 'warning'; className?: string }) {
  const tones = { brand: 'bg-brand-soft text-brand', positive: 'bg-positive/10 text-positive', negative: 'bg-negative/10 text-negative', accent: 'bg-accent/10 text-accent', warning: 'bg-warning/10 text-warning' };
  return (
    <Card className={cn('animate-in p-5', className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium text-muted">{label}</p>
        {icon && <div className={cn('rounded-xl p-2', tones[tone])}>{icon}</div>}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </Card>
  );
}
