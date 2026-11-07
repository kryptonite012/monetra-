'use client';
import { FileUp, Paperclip, Plus, Split, Trash2 } from 'lucide-react';
import { useState } from 'react';
import useSWR from 'swr';
import { DonutChart, Legend, SimpleBars } from '@/components/charts';
import { cleanValues, ConfirmDialog, FormModal, type FieldDef, type FormValues } from '@/components/form-modal';
import { RecurringPanel } from '@/components/money/recurring-panel';
import { Badge, Button, Card, CardBody, CardHeader, DataTable, EmptyState, Field, Input, Modal, Money, PageHeader, Pagination, Select, StatCard, Tabs, useToast } from '@/components/ui';
import { api, ApiError, downloadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatPercent, titleCase, todayISO } from '@/lib/format';
import { qs, useApi } from '@/lib/hooks';
import { useAccountOptions, useCategoryOptions, usePaymentMethodOptions } from '@/lib/options';
import type { Paged } from '@/lib/types';

interface Expense {
  id: string;
  transactionId: string;
  amount: string;
  occurredOn: string;
  description: string;
  accountId: string;
  accountName: string;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  merchantName: string | null;
  paymentMethodId: string | null;
  paymentMethodLabel: string | null;
  paymentMethodType: string | null;
  gstAmount: string | null;
  isTaxDeductible: boolean;
  taxSection: string | null;
  isReimbursable: boolean;
  isSplit: boolean;
  receiptCount: number;
  reference: string | null;
  tags: string[];
}

interface Analytics {
  totals: { total: string; count: number; averagePerDay: string; largestExpense: string; highestSpendDay: { date: string; total: string } | null };
  comparison: { previousPeriod: { total: string }; changePercent: string | null };
  series: Array<{ period: string; total: string }>;
  byCategory: Array<{ name: string; total: string; sharePercent: string; color: string | null }>;
  byMerchant: Array<{ name: string; total: string; count: number }>;
  byPaymentType: Array<{ paymentType: string; total: string; sharePercent: string }>;
}

export default function ExpensesPage() {
  const toast = useToast();
  const { status } = useAuth();
  const accounts = useAccountOptions();
  const categories = useCategoryOptions('expense');
  const methods = usePaymentMethodOptions();
  const [granularity, setGranularity] = useState<'day' | 'week' | 'month'>('day');
  const [filters, setFilters] = useState({ search: '', categoryId: '', page: 1 });
  const { data: analytics, mutate: mutateAnalytics } = useApi<Analytics>(`/expenses/analytics?granularity=${granularity}`);
  const { data, mutate } = useSWR<Paged<Expense>>(status === 'authenticated' ? `/expenses${qs({ ...filters, pageSize: 20 })}` : null, (p: string) => api.page<Expense[]>(p) as Promise<Paged<Expense>>);
  const [editing, setEditing] = useState<Expense | 'new' | null>(null);
  const [viewing, setViewing] = useState<Expense | null>(null);
  const [deleting, setDeleting] = useState<Expense | null>(null);
  const refresh = () => {
    mutate();
    mutateAnalytics();
  };

  const fields: FieldDef[] = [
    { name: 'amount', label: 'Amount (₹)', type: 'money', required: true, half: true },
    { name: 'occurredOn', label: 'Date', type: 'date', required: true, half: true },
    { name: 'description', label: 'What was it for?', required: true, placeholder: 'Groceries at DMart' },
    { name: 'merchantName', label: 'Merchant', half: true },
    { name: 'categoryId', label: 'Category', type: 'select', options: categories, half: true, hint: 'Leave empty to auto-categorise.' },
    { name: 'accountId', label: 'Paid from', type: 'select', required: true, options: accounts, half: true },
    { name: 'paymentMethodId', label: 'Payment method', type: 'select', options: methods, half: true },
    { name: 'reference', label: 'Reference / UTR', half: true },
    { name: 'gstAmount', label: 'GST included (₹)', type: 'money', half: true },
    { name: 'isTaxDeductible', label: 'Tax deductible', type: 'checkbox', half: true },
    { name: 'taxSection', label: 'Tax section', type: 'select', half: true, options: ['80C', '80D', '80E', '80G', '80GG', '80TTA', '24B', 'HRA', 'other'].map((s) => ({ value: s, label: s })), show: (v) => Boolean(v.isTaxDeductible) },
    { name: 'isReimbursable', label: 'Reimbursable (work expense)', type: 'checkbox' },
  ];
  const initial = (e: Expense | 'new'): FormValues =>
    e === 'new'
      ? { occurredOn: todayISO(), accountId: accounts[0]?.value ?? '' }
      : { amount: e.amount, occurredOn: e.occurredOn, description: e.description, merchantName: e.merchantName ?? '', categoryId: e.categoryId ?? '', accountId: e.accountId, paymentMethodId: e.paymentMethodId ?? '', reference: e.reference ?? '', gstAmount: e.gstAmount ?? '', isTaxDeductible: e.isTaxDeductible, taxSection: e.taxSection ?? '', isReimbursable: e.isReimbursable };

  const change = analytics?.comparison.changePercent;
  return (
    <div className="space-y-6">
      <PageHeader title="Expenses" description="Track spending by category, merchant and payment mode. Receipts and splits included." actions={<Button onClick={() => setEditing('new')}><Plus className="h-4 w-4" /> Add expense</Button>} />
      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard label="Spent this month" value={<Money value={analytics?.totals.total} />} tone="negative" hint={change ? `${Number(change) > 0 ? '▲' : '▼'} ${formatPercent(Math.abs(Number(change)))} vs previous period` : `${analytics?.totals.count ?? 0} expenses`} />
        <StatCard label="Average per day" value={<Money value={analytics?.totals.averagePerDay} />} />
        <StatCard label="Largest expense" value={<Money value={analytics?.totals.largestExpense} />} tone="warning" />
        <StatCard label="Highest-spend day" value={analytics?.totals.highestSpendDay ? <Money value={analytics.totals.highestSpendDay.total} /> : '—'} hint={analytics?.totals.highestSpendDay ? formatDate(analytics.totals.highestSpendDay.date) : undefined} tone="accent" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Spending over time" action={<Tabs value={granularity} onChange={setGranularity} tabs={[{ value: 'day', label: 'Daily' }, { value: 'week', label: 'Weekly' }, { value: 'month', label: 'Monthly' }]} />} />
          <CardBody>{analytics?.series.length ? <SimpleBars data={analytics.series.map((s) => ({ name: granularity === 'month' ? s.period.slice(0, 7) : s.period.slice(5), value: Number(s.total) }))} color="#e11d48" /> : <EmptyState title="No spending in this period" />}</CardBody>
        </Card>
        <Card>
          <CardHeader title="By category" />
          <CardBody>
            {analytics?.byCategory.length ? (
              <>
                <DonutChart data={analytics.byCategory.map((c) => ({ name: c.name, value: Number(c.total), color: c.color }))} height={170} />
                <Legend items={analytics.byCategory.slice(0, 6).map((c) => ({ name: c.name, value: c.total, color: c.color, extra: `${c.sharePercent}%` }))} />
              </>
            ) : (
              <EmptyState title="No data" />
            )}
          </CardBody>
        </Card>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader title="Top merchants" />
          <CardBody className="space-y-2">
            {analytics?.byMerchant.map((m) => (
              <div key={m.name} className="flex justify-between text-sm"><span>{m.name} <span className="text-xs text-muted">×{m.count}</span></span><Money value={m.total} /></div>
            ))}
            {!analytics?.byMerchant.length && <p className="text-sm text-muted">Add merchant names to see where you spend most.</p>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="By payment mode" />
          <CardBody className="space-y-2">
            {analytics?.byPaymentType.map((p) => (
              <div key={p.paymentType} className="flex justify-between text-sm"><span>{titleCase(p.paymentType)}</span><span className="text-muted"><Money value={p.total} /> · {p.sharePercent}%</span></div>
            ))}
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader
          title="All expenses"
          action={
            <div className="flex gap-2">
              <Input placeholder="Search" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value, page: 1 })} className="h-8 w-40" aria-label="Search expenses" />
              <Select value={filters.categoryId} onChange={(e) => setFilters({ ...filters, categoryId: e.target.value, page: 1 })} className="h-8 w-44" aria-label="Category filter">
                <option value="">All categories</option>
                {categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </Select>
            </div>
          }
        />
        <DataTable
          rows={data?.data}
          loading={!data}
          onRowClick={setViewing}
          columns={[
            { key: 'date', header: 'Date', render: (e) => formatDate(e.occurredOn) },
            { key: 'desc', header: 'Description', render: (e) => <div><p className="font-medium">{e.description}</p><p className="text-xs text-muted">{e.merchantName ?? ''}{e.paymentMethodLabel ? ` · ${e.paymentMethodLabel}` : ''}</p></div> },
            { key: 'cat', header: 'Category', hideOnMobile: true, render: (e) => <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: e.categoryColor ?? 'var(--muted)' }} />{e.categoryName ?? '—'}</span> },
            { key: 'flags', header: '', hideOnMobile: true, render: (e) => <div className="flex gap-1">{e.receiptCount > 0 && <Badge><Paperclip className="h-3 w-3" />{e.receiptCount}</Badge>}{e.isSplit && <Badge tone="accent">Split</Badge>}{e.isTaxDeductible && <Badge tone="positive">{e.taxSection ?? 'Tax'}</Badge>}</div> },
            { key: 'amount', header: 'Amount', align: 'right', render: (e) => <Money value={e.amount} className="font-medium" /> },
          ]}
          empty={<EmptyState title="No expenses yet" action={<Button onClick={() => setEditing('new')}>Add expense</Button>} />}
        />
        {data && <Pagination page={data.meta.page} totalPages={data.meta.totalPages} onPage={(p) => setFilters({ ...filters, page: p })} />}
      </Card>
      <RecurringPanel kind="expense" onPosted={refresh} />

      <FormModal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Add expense' : 'Edit expense'}
        description={editing === 'new' ? undefined : 'Saving reverses the original ledger entry and posts the corrected one.'}
        fields={fields}
        initial={editing ? initial(editing) : undefined}
        onSubmit={async (v) => {
          if (editing === 'new') {
            const r = await api.post<{ warnings: string[] }>('/expenses', cleanValues(v));
            toast(r.warnings?.length ? `Saved. ${r.warnings[0]}` : 'Expense added', r.warnings?.length ? 'info' : 'success');
          } else {
            await api.put(`/expenses/${(editing as Expense).id}`, { ...cleanValues(v), reason: 'Edited from expenses page' });
            toast('Expense updated');
          }
          refresh();
        }}
      />
      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing?.description ?? ''} description={viewing ? `${formatDate(viewing.occurredOn)} · ${viewing.accountName}` : undefined} size="lg">
        {viewing && (
          <ExpenseDetail
            expense={viewing}
            accounts={accounts}
            onEdit={() => { setEditing(viewing); setViewing(null); }}
            onDelete={() => { setDeleting(viewing); setViewing(null); }}
            onChanged={refresh}
          />
        )}
      </Modal>
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} title="Delete expense" message="The ledger entry will be reversed; history is kept." danger confirmLabel="Delete" onConfirm={async () => { await api.delete(`/expenses/${deleting!.id}`, { reason: 'Deleted from expenses page' }); refresh(); }} />
    </div>
  );
}

interface ExpenseFull extends Expense {
  splits: Array<{ id: string; participantName: string; shareAmount: string; isSettled: boolean; settledOn: string | null }>;
  receipts: Array<{ id: string; originalFilename: string; mimeType: string; sizeBytes: number; uploadedAt: string }>;
}

function ExpenseDetail({ expense, accounts, onEdit, onDelete, onChanged }: { expense: Expense; accounts: Array<{ value: string; label: string }>; onEdit: () => void; onDelete: () => void; onChanged: () => void }) {
  const toast = useToast();
  const { data, mutate } = useApi<ExpenseFull>(`/expenses/${expense.id}`);
  const [uploading, setUploading] = useState(false);
  const [people, setPeople] = useState('');
  const [includeSelf, setIncludeSelf] = useState(true);
  const [settleAccount, setSettleAccount] = useState(accounts[0]?.value ?? '');

  async function upload(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      await api.upload(`/expenses/${expense.id}/receipts`, form);
      toast('Receipt attached');
      mutate();
      onChanged();
    } catch (err) {
      toast((err as ApiError).message, 'error');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Money value={expense.amount} className="text-2xl font-semibold" />
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={onEdit}>Edit</Button>
          <Button size="sm" variant="ghost" onClick={onDelete}><Trash2 className="h-4 w-4" /> Delete</Button>
        </div>
      </div>
      <div>
        <p className="mb-2 text-xs font-medium text-muted">Receipts</p>
        <div className="space-y-2">
          {data?.receipts.map((r) => (
            <div key={r.id} className="flex items-center justify-between rounded-xl border border-border px-3 py-2 text-sm">
              <button className="truncate text-left text-brand hover:underline" onClick={() => downloadFile(`/receipts/${r.id}/file`, r.originalFilename)}>{r.originalFilename}</button>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted">{Math.ceil(r.sizeBytes / 1024)} KB</span>
                <button className="text-muted hover:text-negative" aria-label="Delete receipt" onClick={async () => { await api.delete(`/receipts/${r.id}`); mutate(); onChanged(); }}><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
          ))}
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-border px-3 py-4 text-sm text-muted hover:border-brand hover:text-brand">
            <FileUp className="h-4 w-4" /> {uploading ? 'Uploading…' : 'Attach receipt (JPEG, PNG, WEBP or PDF, max 5 MB)'}
            <input type="file" className="hidden" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </label>
        </div>
      </div>
      <div>
        <p className="mb-2 text-xs font-medium text-muted">Split with friends</p>
        {data?.splits.length ? (
          <ul className="space-y-2">
            {data.splits.map((s) => (
              <li key={s.id} className="flex items-center justify-between rounded-xl border border-border px-3 py-2 text-sm">
                <span>{s.participantName} owes <Money value={s.shareAmount} /></span>
                {s.isSettled ? (
                  <Badge tone="positive">Settled {formatDate(s.settledOn)}</Badge>
                ) : (
                  <div className="flex items-center gap-2">
                    <Select value={settleAccount} onChange={(e) => setSettleAccount(e.target.value)} className="h-8 w-36" aria-label="Received into">
                      {accounts.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                    </Select>
                    <Button size="sm" variant="secondary" onClick={async () => { await api.post(`/splits/${s.id}/settle`, { accountId: settleAccount }); toast('Marked as settled'); mutate(); }}>Settle</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <Field label="Names (comma separated)" className="flex-1"><Input value={people} onChange={(e) => setPeople(e.target.value)} placeholder="Kabir, Ananya" /></Field>
            <label className="flex items-center gap-2 pb-2 text-xs text-muted"><input type="checkbox" checked={includeSelf} onChange={(e) => setIncludeSelf(e.target.checked)} /> Include me</label>
            <Button
              variant="secondary"
              disabled={!people.trim()}
              onClick={async () => {
                try {
                  const r = await api.post<{ owedToYou: string }>(`/expenses/${expense.id}/splits`, { method: 'equal', includeSelf, participants: people.split(',').map((n) => ({ name: n.trim() })).filter((p) => p.name) });
                  toast(`Split saved. You are owed ₹${r.owedToYou}`);
                  mutate();
                  onChanged();
                } catch (err) {
                  toast((err as ApiError).message, 'error');
                }
              }}
            >
              <Split className="h-4 w-4" /> Split equally
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
