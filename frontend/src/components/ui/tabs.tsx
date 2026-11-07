'use client';
import { cn } from '@/lib/cn';

export function Tabs<T extends string>({ tabs, value, onChange, className }: { tabs: Array<{ value: T; label: string; count?: number }>; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div role="tablist" className={cn('inline-flex rounded-xl border border-border bg-surface-2 p-1', className)}>
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cn('rounded-lg px-3 py-1.5 text-xs font-medium transition-colors', value === t.value ? 'bg-surface text-text shadow-sm' : 'text-muted hover:text-text')}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 text-muted">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
