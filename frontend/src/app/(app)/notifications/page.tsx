'use client';
import { AlertTriangle, Bell, CheckCheck, CheckCircle2, Info, ShieldAlert, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';
import { Button, Card, EmptyState, PageHeader, Pagination, Tabs } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { formatDateTime, titleCase } from '@/lib/format';
import { qs } from '@/lib/hooks';
import type { Paged } from '@/lib/types';

interface Notification {
  id: string;
  type: string;
  severity: 'info' | 'success' | 'warning' | 'critical';
  title: string;
  body: string;
  actionUrl: string | null;
  readAt: string | null;
  createdAt: string;
}

const icons = { info: Info, success: CheckCircle2, warning: AlertTriangle, critical: ShieldAlert };
const colors = { info: 'bg-accent/10 text-accent', success: 'bg-positive/10 text-positive', warning: 'bg-warning/10 text-warning', critical: 'bg-negative/10 text-negative' };

export default function NotificationsPage() {
  const { status } = useAuth();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [page, setPage] = useState(1);
  const { data, mutate } = useSWR<Paged<Notification>>(status === 'authenticated' ? `/notifications${qs({ unread: filter === 'unread' ? 'true' : undefined, page, pageSize: 20 })}` : null, (p: string) => api.page<Notification[]>(p) as Promise<Paged<Notification>>);

  return (
    <div>
      <PageHeader
        title="Notifications"
        description="Budget alerts, bill and EMI reminders, unusual spending, goal milestones and security events. Choose email alerts in your profile."
        actions={<Button variant="secondary" onClick={async () => { await api.post('/notifications/read-all'); mutate(); }}><CheckCheck className="h-4 w-4" /> Mark all read</Button>}
      />
      <Tabs className="mb-4" value={filter} onChange={(v) => { setFilter(v); setPage(1); }} tabs={[{ value: 'all', label: 'All' }, { value: 'unread', label: 'Unread', count: data?.meta.unread }]} />
      <Card>
        {data?.data.length ? (
          <ul className="divide-y divide-border/70">
            {data.data.map((n) => {
              const Icon = icons[n.severity];
              return (
                <li key={n.id} className={cn('flex gap-4 px-5 py-4', !n.readAt && 'bg-brand-soft/30')}>
                  <div className={cn('h-fit rounded-xl p-2', colors[n.severity])}><Icon className="h-4 w-4" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{n.title}</p>
                      {!n.readAt && <span className="h-2 w-2 rounded-full bg-brand" aria-label="Unread" />}
                    </div>
                    <p className="text-sm text-muted">{n.body}</p>
                    <p className="mt-1 text-xs text-muted">{titleCase(n.type)} · {formatDateTime(n.createdAt)}</p>
                  </div>
                  <div className="flex shrink-0 items-start gap-1">
                    {n.actionUrl && (
                      <Link href={n.actionUrl} onClick={() => api.patch(`/notifications/${n.id}/read`).then(() => mutate())} className="rounded-lg px-2 py-1 text-xs text-brand hover:bg-surface-2">Open</Link>
                    )}
                    {!n.readAt && <button onClick={async () => { await api.patch(`/notifications/${n.id}/read`); mutate(); }} className="rounded-lg px-2 py-1 text-xs text-muted hover:bg-surface-2">Read</button>}
                    <button onClick={async () => { await api.delete(`/notifications/${n.id}`); mutate(); }} className="rounded-lg p-1 text-muted hover:text-negative" aria-label="Dismiss"><Trash2 className="h-4 w-4" /></button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="p-5"><EmptyState icon={<Bell className="h-5 w-5" />} title={filter === 'unread' ? 'You are all caught up' : 'No notifications yet'} /></div>
        )}
        {data && <Pagination page={data.meta.page} totalPages={data.meta.totalPages} onPage={setPage} />}
      </Card>
    </div>
  );
}
