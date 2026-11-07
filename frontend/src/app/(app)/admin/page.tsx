'use client';
import { useState } from 'react';
import useSWR from 'swr';
import { FormModal } from '@/components/form-modal';
import { Badge, Button, Card, CardHeader, DataTable, EmptyState, Input, PageHeader, StatCard, Tabs, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import { qs, useApi } from '@/lib/hooks';
import type { Paged } from '@/lib/types';

interface AdminUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
  status: string;
  mfaEnabled: boolean;
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

export default function AdminPage() {
  const { user, status } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState<'users' | 'audit'>('users');
  const [search, setSearch] = useState('');
  const isStaff = user?.role === 'admin' || user?.role === 'support';
  const { data: stats } = useApi<{ users: { total: number; active: number; mfaEnabled: number; emailVerified: number }; activeSessions: number; logins24h: { succeeded: number; failed: number } }>(isStaff ? '/admin/stats' : null);
  const fetchPage = (p: string) => api.page(p);
  const { data: users, mutate } = useSWR<Paged<AdminUser>>(status === 'authenticated' && isStaff ? `/admin/users${qs({ search, pageSize: 50 })}` : null, fetchPage as (p: string) => Promise<Paged<AdminUser>>);
  const { data: audit } = useSWR<Paged<{ id: number; action: string; userId: string | null; actorId: string | null; ip: string | null; createdAt: string }>>(status === 'authenticated' && isStaff && tab === 'audit' ? '/admin/audit-logs?pageSize=50' : null, fetchPage as never);
  const [editing, setEditing] = useState<AdminUser | null>(null);

  if (!isStaff) return <EmptyState title="Administrators only" description="You do not have access to this area." />;

  return (
    <div className="space-y-6">
      <PageHeader title="Administration" description="Manage accounts and review the audit trail. By design, administrators cannot see users' financial records." />
      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard label="Users" value={<span className="num">{stats?.users.total ?? '—'}</span>} hint={`${stats?.users.active ?? 0} active`} />
        <StatCard label="Two-factor enabled" value={<span className="num">{stats?.users.mfaEnabled ?? '—'}</span>} tone="positive" />
        <StatCard label="Active sessions" value={<span className="num">{stats?.activeSessions ?? '—'}</span>} tone="accent" />
        <StatCard label="Sign-ins (24h)" value={<span className="num">{stats?.logins24h.succeeded ?? 0}</span>} hint={`${stats?.logins24h.failed ?? 0} failed`} tone="warning" />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'users', label: 'Users' }, { value: 'audit', label: 'Audit log' }]} />
      {tab === 'users' ? (
        <Card>
          <CardHeader title="Accounts" action={<Input className="h-8 w-56" placeholder="Search email or name" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search users" />} />
          <DataTable
            rows={users?.data}
            loading={!users}
            columns={[
              { key: 'u', header: 'User', render: (u) => <div><p className="font-medium">{u.fullName}</p><p className="text-xs text-muted">{u.email}</p></div> },
              { key: 'r', header: 'Role', render: (u) => <Badge tone={u.role === 'admin' ? 'accent' : 'neutral'}>{u.role}</Badge> },
              { key: 's', header: 'Status', render: (u) => <Badge tone={u.status === 'active' ? 'positive' : 'negative'}>{u.status}</Badge> },
              { key: 'm', header: 'Security', hideOnMobile: true, render: (u) => <span className="text-xs text-muted">{u.mfaEnabled ? '2FA' : 'no 2FA'} · {u.emailVerifiedAt ? 'verified' : 'unverified'}</span> },
              { key: 'l', header: 'Last sign-in', hideOnMobile: true, render: (u) => <span className="text-xs">{formatDateTime(u.lastLoginAt)}</span> },
              { key: 'x', header: '', align: 'right', render: (u) => (u.id !== user?.id && user?.role === 'admin' ? <Button size="sm" variant="ghost" onClick={() => setEditing(u)}>Manage</Button> : null) },
            ]}
          />
        </Card>
      ) : (
        <Card>
          <DataTable
            rows={audit?.data}
            loading={!audit}
            rowKey={(a) => String(a.id)}
            columns={[
              { key: 'w', header: 'When', render: (a) => <span className="text-xs">{formatDateTime(a.createdAt)}</span> },
              { key: 'a', header: 'Action', render: (a) => <code className="text-xs">{a.action}</code> },
              { key: 'u', header: 'Subject', hideOnMobile: true, render: (a) => <span className="font-mono text-[11px] text-muted">{a.userId?.slice(0, 8) ?? '—'}</span> },
              { key: 'i', header: 'IP', render: (a) => <span className="text-xs text-muted">{a.ip ?? '—'}</span> },
            ]}
          />
        </Card>
      )}
      <FormModal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={`Manage ${editing?.email ?? ''}`}
        description="Disabling or locking an account signs it out everywhere. Every change is audited."
        fields={[
          { name: 'status', label: 'Status', type: 'select', required: true, half: true, options: ['active', 'locked', 'disabled'].map((s) => ({ value: s, label: s })) },
          { name: 'role', label: 'Role', type: 'select', required: true, half: true, options: ['user', 'support', 'admin'].map((s) => ({ value: s, label: s })) },
          { name: 'reason', label: 'Reason for status change', required: true },
        ]}
        initial={{ status: editing?.status ?? 'active', role: editing?.role ?? 'user' }}
        onSubmit={async (v) => {
          if (v.status !== editing!.status) await api.patch(`/admin/users/${editing!.id}/status`, { status: v.status, reason: v.reason });
          if (v.role !== editing!.role) await api.patch(`/admin/users/${editing!.id}/role`, { role: v.role });
          toast('User updated');
          mutate();
        }}
      />
    </div>
  );
}
