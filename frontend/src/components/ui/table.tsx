'use client';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { EmptyState } from './empty-state';
import { Skeleton } from './skeleton';

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
  hideOnMobile?: boolean;
}

export function DataTable<T extends { id?: string }>({ columns, rows, loading, empty, onRowClick, rowKey }: { columns: Column<T>[]; rows: T[] | undefined; loading?: boolean; empty?: ReactNode; onRowClick?: (row: T) => void; rowKey?: (row: T, i: number) => string }) {
  if (loading && !rows) {
    return (
      <div className="space-y-2 p-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }
  if (!rows?.length) return <div className="p-5">{empty ?? <EmptyState title="Nothing here yet" />}</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted">
            {columns.map((c) => (
              <th key={c.key} className={cn('px-5 py-2.5 font-medium', c.align === 'right' && 'text-right', c.align === 'center' && 'text-center', c.hideOnMobile && 'hidden md:table-cell', c.className)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={rowKey ? rowKey(row, i) : (row.id ?? String(i))}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn('border-b border-border/60 last:border-0', onRowClick && 'cursor-pointer hover:bg-surface-2/60')}
            >
              {columns.map((c) => (
                <td key={c.key} className={cn('px-5 py-3 align-middle', c.align === 'right' && 'text-right', c.align === 'center' && 'text-center', c.hideOnMobile && 'hidden md:table-cell', c.className)}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (p: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between border-t border-border px-5 py-3 text-xs text-muted">
      <span>
        Page {page} of {totalPages}
      </span>
      <div className="flex gap-2">
        <button className="rounded-lg border border-border px-3 py-1 hover:bg-surface-2 disabled:opacity-50" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </button>
        <button className="rounded-lg border border-border px-3 py-1 hover:bg-surface-2 disabled:opacity-50" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}
