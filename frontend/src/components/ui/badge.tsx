import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Tone = 'neutral' | 'brand' | 'positive' | 'negative' | 'warning' | 'accent';

const tones: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-muted border-border',
  brand: 'bg-brand-soft text-brand border-transparent',
  positive: 'bg-positive/10 text-positive border-transparent',
  negative: 'bg-negative/10 text-negative border-transparent',
  warning: 'bg-warning/10 text-warning border-transparent',
  accent: 'bg-accent/10 text-accent border-transparent',
};

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium', tones[tone], className)}>{children}</span>;
}
