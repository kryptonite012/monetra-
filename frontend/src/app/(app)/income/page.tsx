'use client';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { SimpleBars } from '@/components/charts';
import { cleanValues, ConfirmDialog, FormModal, type FieldDef, type FormValues } from '@/components/form-modal';
import { RecurringPanel } from '@/components/money/recurring-panel';
import { Badge, Button, Card, CardBody, CardHeader, DataTable, EmptyState, Money, PageHeader, Pagination, Progress, StatCard, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate, formatMonth, titleCase, todayISO } from '@/lib/format';
import { qs, useApi } from '@/lib/hooks';
import { enumOptions, useAccountOptions } from '@/lib/options';
import type { Paged } from '@/lib/types';
import useSWR from 'swr';
import { useAuth } from '@/lib/auth';

const SOURCES = ['salary', 'bonus', 'business', 'freelance', 'rental', 'interest', 'dividend', 'capital_gains', 'pension', 'gift', 'refund', 'other'] as const;

interface IncomeRow {
  id: string;
  sourceType: string;
  payerName: string | null;
  grossAmount: string;
  taxDeducted: string;
  otherDeductions: string;
  netAmount: string;
  occurredOn: string;
  description: string;
  accountId: string;
  accountName: string;
  periodMonth: string | null;
  isTaxable: boolean;
  reference: string | null;
}

interface Summary {
  totals: { gross: string; taxDeducted: string; net: string; averageMonthlyNet: string };
  byMonth: Array<{ month: string; net: string }>;
  bySource: Array<{ sourceType: string; net: string; sharePercent: string; count: number }>;
  period: { from: string; to: string };
}

export default function IncomePage() {
  const toast = useToast();
  const { status } = useAuth();
  const accounts = useAccountOptions();
  const [page, setPage] = useState(1);
  const { data: summary, mutate: mutateSummary } = useApi<Summary>('/income/summary');
  const { data, mutate } = useSWR<Paged<IncomeRow>>(status === 'authenticated' ? `/income${qs({ page, pageSize: 20 })}` : null, (p: string) => api.page<IncomeRow[]>(p) as Promise<Paged<IncomeRow>>);
  const [editing, setEditing] = useState<IncomeRow | 'new' | null>(null);
  const [deleting, setDeleting] = useState<IncomeRow | null>(null);
  const refresh = () => {
    mutate();
    mutateSummary();
  };

  const fields: FieldDef[] = [
    { name: 'sourceType', label: 'Source', type: 'select', required: true, options: enumOptions(SOURCES), half: true },
    { name: 'accountId', label: 'Credited to', type: 'select', required: true, options: accounts, half: true },
    { name: 'grossAmount', label: 'Gross amount (₹)', type: 'money', required: true, half: true },
    { name: 'occurredOn', label: 'Date received', type: 'date', required: true, half: true },
    { name: 'taxDeducted', label: 'TDS deducted (₹)', type: 'money', half: true },
    { name: 'otherDeductions', label: 'Other deductions (PF, etc.)', type: 'money', half: true },
    { name: 'payerName', label: 'Payer / employer', half: true },
    { name: 'periodMonth', label: 'For month', type: 'month', half: true },
    { name: 'description', label: 'Description' },
    { name: 'reference', label: 'Reference / UTR' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ];

  const initial = (r: IncomeRow | 'new'): FormValues =>
    r === 'new'
      ? { sourceType: 'salary', occurredOn: todayISO(), accountId: accounts[0]?.value ?? '' }
      : { sourceType: r.sourceType, accountId: r.accountId, grossAmount: r.grossAmount, taxDeducted: r.taxDeducted, otherDeductions: r.otherDeductions, occurredOn: r.occurredOn, payerName: r.payerName ?? '', periodMonth: r.periodMonth?.slice(0, 7) ?? '', description: r.description, reference: r.reference ?? '' };

  const maxShare = Math.max(1, ...(summary?.bySource.map((s) => Number(s.sharePercent)) ?? [1]));

  return (
    <div className="space-y-6">
      <PageHeader title="Income" description="Salary, business, freelance, rental, interest and other earnings, with TDS tracking." actions={<Button onClick={() => setEditing('new')}><Plus className="h-4 w-4" /> Record income</Button>} />
      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard label="Net income (this FY)" value={<Money value={summary?.totals.net} />} tone="positive" hint={summary ? `${formatDate(summary.period.from)} – ${formatDate(summary.period.to)}` : undefined} />
        <StatCard label="Gross income" value={<Money value={summary?.totals.gross} />} />
        <StatCard label="TDS deducted" value={<Money value={summary?.totals.taxDeducted} />} tone="warning" />
        <StatCard label="Average per month" value={<Money value={summary?.totals.averageMonthlyNet} />} tone="accent" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Monthly income" />
          <CardBody>{summary?.byMonth.length ? <SimpleBars data={summary.byMonth.map((m) => ({ name: formatMonth(m.month), value: Number(m.net) }))} /> : <EmptyState title="No income recorded this year" />}</CardBody>
        </Card>
        <Card>
          <CardHeader title="By source" />
          <CardBody className="space-y-3">
            {summary?.bySource.map((s) => (
              <div key={s.sourceType}>
                <div className="flex justify-between text-sm"><span>{titleCase(s.sourceType)}</span><Money value={s.net} /></div>
                <Progress value={(Number(s.sharePercent) / maxShare) * 100} className="mt-1 h-1.5" />
                <p className="mt-0.5 text-xs text-muted">{s.sharePercent}% · {s.count} entries</p>
              </div>
            ))}
            {!summary?.bySource.length && <p className="text-sm text-muted">Nothing yet.</p>}
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader title="Income records" />
        <DataTable
          rows={data?.data}
          loading={!data}
          onRowClick={(r) => setEditing(r)}
          columns={[
            { key: 'date', header: 'Date', render: (r) => formatDate(r.occurredOn) },
            { key: 'desc', header: 'Description', render: (r) => <div><p className="font-medium">{r.description}</p><p className="text-xs text-muted">{r.accountName}</p></div> },
            { key: 'src', header: 'Source', hideOnMobile: true, render: (r) => <Badge tone="positive">{titleCase(r.sourceType)}</Badge> },
            { key: 'gross', header: 'Gross', align: 'right', hideOnMobile: true, render: (r) => <Money value={r.grossAmount} /> },
            { key: 'tds', header: 'TDS', align: 'right', hideOnMobile: true, render: (r) => <Money value={r.taxDeducted} /> },
            { key: 'net', header: 'Net', align: 'right', render: (r) => <Money value={r.netAmount} tone="positive" className="font-medium" /> },
            { key: 'x', header: '', align: 'right', render: (r) => <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setDeleting(r); }}>Delete</Button> },
          ]}
          empty={<EmptyState title="No income yet" action={<Button onClick={() => setEditing('new')}>Record income</Button>} />}
        />
        {data && <Pagination page={data.meta.page} totalPages={data.meta.totalPages} onPage={setPage} />}
      </Card>
      <RecurringPanel kind="income" onPosted={refresh} />

      <FormModal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Record income' : 'Edit income'}
        description={editing === 'new' ? 'The net amount (gross minus deductions) is credited to the account.' : 'Editing reverses the original ledger entry and posts a corrected one.'}
        fields={fields}
        initial={editing ? initial(editing) : undefined}
        onSubmit={async (v) => {
          if (editing === 'new') await api.post('/income', cleanValues(v));
          else await api.put(`/income/${(editing as IncomeRow).id}`, { ...cleanValues(v), reason: 'Edited from income page' });
          toast('Income saved');
          refresh();
        }}
      />
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} title="Delete income" message="The ledger entry will be reversed; history is kept." danger confirmLabel="Delete" onConfirm={async () => { await api.delete(`/income/${deleting!.id}`, { reason: 'Deleted from income page' }); refresh(); }} />
    </div>
  );
}
