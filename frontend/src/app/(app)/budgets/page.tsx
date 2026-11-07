'use client';
import { AlertTriangle, ChevronLeft, ChevronRight, Copy, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { MultiLine } from '@/components/charts';
import { cleanValues, ConfirmDialog, FormModal } from '@/components/form-modal';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Input, Money, PageHeader, PageLoader, Progress, Select, StatCard, useToast } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { currentMonth, formatMoney, formatMonth } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { useCategoryOptions } from '@/lib/options';

interface CategoryLine {
  id: string;
  categoryId: string;
  name: string;
  color: string | null;
  limit: string;
  spent: string;
  remaining: string;
  utilizationPercent: string;
  status: 'ok' | 'warning' | 'exceeded';
  projectedSpend: string;
  projectedOverrun: string;
  dailyAllowance: string;
  alertThresholdPct: number;
}

interface Budget {
  id: string;
  month: string;
  name: string;
  period: { isCurrent: boolean; daysElapsed: number; totalDays: number };
  totals: { limit: string; spent: string; remaining: string; utilizationPercent: string; status: string; unbudgetedSpend: string; projectedSpend: string; income: string; savingsTarget: string | null; actualSavings: string; savingsTargetMet: boolean | null; savingsRatePercent: string };
  categories: CategoryLine[];
  alerts: Array<{ name: string; status: string; message: string }>;
}

function shiftMonth(m: string, delta: number) {
  const d = new Date(`${m}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + delta);
  return d.toISOString().slice(0, 7);
}

export default function BudgetsPage() {
  const toast = useToast();
  const [month, setMonth] = useState(currentMonth());
  const { data: budget, mutate, isLoading } = useApi<Budget | null>(`/budgets?month=${month}`);
  const { data: history, mutate: mutateHistory } = useApi<Array<{ month: string; limit: string; spent: string; actualSavings: string }>>('/budgets/history?months=6');
  const categories = useCategoryOptions('expense');
  const [lines, setLines] = useState<Array<{ categoryId: string; limitAmount: string }>>([{ categoryId: '', limitAmount: '' }]);
  const [savingsTarget, setSavingsTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editTotals, setEditTotals] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const refresh = () => {
    mutate();
    mutateHistory();
  };

  async function create() {
    setBusy(true);
    try {
      await api.post('/budgets', { month, savingsTarget: savingsTarget || undefined, categories: lines.filter((l) => l.categoryId && l.limitAmount).map((l) => ({ ...l, alertThresholdPct: 80 })) });
      toast('Budget created');
      refresh();
    } catch (err) {
      toast((err as ApiError).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Budgets"
        description="Monthly limits by category, with alerts at your threshold and month-end projections."
        actions={
          <div className="flex items-center gap-1 rounded-xl border border-border bg-surface p-1">
            <Button size="icon" variant="ghost" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></Button>
            <span className="num min-w-24 text-center text-sm font-medium">{formatMonth(month)}</span>
            <Button size="icon" variant="ghost" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month"><ChevronRight className="h-4 w-4" /></Button>
          </div>
        }
      />
      {isLoading ? (
        <PageLoader />
      ) : !budget ? (
        <Card>
          <CardHeader title={`Create a budget for ${formatMonth(month)}`} description="Set limits for the categories you want to watch. Sub-category spending counts towards its parent." />
          <CardBody className="space-y-3">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-12 gap-2">
                <Select className="col-span-7" value={l.categoryId} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, categoryId: e.target.value } : x)))} aria-label="Category">
                  <option value="">Choose category…</option>
                  {categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </Select>
                <Input className="num col-span-4" inputMode="decimal" placeholder="Limit ₹" value={l.limitAmount} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, limitAmount: e.target.value.replace(/[^\d.]/g, '') } : x)))} aria-label="Limit" />
                <button className="col-span-1 text-muted hover:text-negative" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Remove"><Trash2 className="mx-auto h-4 w-4" /></button>
              </div>
            ))}
            <Button size="sm" variant="secondary" onClick={() => setLines([...lines, { categoryId: '', limitAmount: '' }])}><Plus className="h-4 w-4" /> Add category</Button>
            <Field label="Savings target for the month (optional)" className="max-w-xs">
              <Input className="num" inputMode="decimal" value={savingsTarget} onChange={(e) => setSavingsTarget(e.target.value.replace(/[^\d.]/g, ''))} placeholder="20000" />
            </Field>
            <div className="flex gap-2">
              <Button loading={busy} onClick={create}>Create budget</Button>
              <Button
                variant="ghost"
                onClick={async () => {
                  const prev = await api.get<Budget | null>(`/budgets?month=${shiftMonth(month, -1)}`);
                  if (!prev) return toast('No budget last month to copy', 'info');
                  await api.post(`/budgets/${prev.id}/copy`, { toMonth: month });
                  toast('Copied last month’s budget');
                  refresh();
                }}
              >
                <Copy className="h-4 w-4" /> Copy last month
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-4">
            <StatCard label="Spent" value={<Money value={budget.totals.spent} />} hint={`of ${formatMoney(budget.totals.limit)} · ${budget.totals.utilizationPercent}%`} tone={budget.totals.status === 'exceeded' ? 'negative' : budget.totals.status === 'warning' ? 'warning' : 'brand'} />
            <StatCard label="Remaining" value={<Money value={budget.totals.remaining} tone={Number(budget.totals.remaining) < 0 ? 'negative' : 'none'} />} hint={budget.period.isCurrent ? `${budget.period.totalDays - budget.period.daysElapsed} days left` : undefined} />
            <StatCard label="Projected month-end" value={<Money value={budget.totals.projectedSpend} />} hint={budget.period.isCurrent ? 'At current daily pace (estimate)' : 'Actual'} tone="accent" />
            <StatCard label="Savings" value={<Money value={budget.totals.actualSavings} tone="auto" />} hint={budget.totals.savingsTarget ? `Target ${formatMoney(budget.totals.savingsTarget)} ${budget.totals.savingsTargetMet ? '✓' : ''}` : `${budget.totals.savingsRatePercent}% of income`} tone="positive" />
          </div>
          {budget.alerts.length > 0 && (
            <Card className="border-warning/40 bg-warning/5 p-4">
              {budget.alerts.map((a) => (
                <p key={a.name} className="flex items-center gap-2 text-sm"><AlertTriangle className={a.status === 'exceeded' ? 'h-4 w-4 text-negative' : 'h-4 w-4 text-warning'} />{a.message}</p>
              ))}
            </Card>
          )}
          <Card>
            <CardHeader
              title="Category limits"
              description={Number(budget.totals.unbudgetedSpend) > 0 ? `${formatMoney(budget.totals.unbudgetedSpend)} spent in categories without a limit` : undefined}
              action={
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add limit</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditTotals(true)}>Targets</Button>
                  <Button size="sm" variant="ghost" onClick={async () => { await api.post(`/budgets/${budget.id}/copy`, { toMonth: shiftMonth(month, 1) }).then(() => toast('Copied to next month')).catch((e: ApiError) => toast(e.message, 'error')); }}><Copy className="h-4 w-4" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeleting(true)} aria-label="Delete budget"><Trash2 className="h-4 w-4" /></Button>
                </div>
              }
            />
            <CardBody className="space-y-4">
              {budget.categories.length ? (
                budget.categories.map((c) => (
                  <div key={c.id} className="animate-in">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span className="flex items-center gap-2 font-medium"><span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color ?? 'var(--brand)' }} />{c.name}</span>
                      <span className="num text-muted"><Money value={c.spent} className="text-text" /> / {formatMoney(c.limit)}</span>
                    </div>
                    <Progress value={Number(c.utilizationPercent)} tone={c.status === 'exceeded' ? 'negative' : c.status === 'warning' ? 'warning' : 'positive'} className="mt-1.5" />
                    <div className="mt-1 flex flex-wrap justify-between gap-2 text-xs text-muted">
                      <span>{c.utilizationPercent}% used{c.status !== 'ok' && <Badge tone={c.status === 'exceeded' ? 'negative' : 'warning'} className="ml-2">{c.status === 'exceeded' ? 'Over budget' : `Above ${c.alertThresholdPct}%`}</Badge>}</span>
                      <span>{Number(c.projectedOverrun) > 0 ? `Projected to overrun by ${formatMoney(c.projectedOverrun)}` : Number(c.dailyAllowance) > 0 ? `${formatMoney(c.dailyAllowance)}/day left to spend` : ''}</span>
                    </div>
                  </div>
                ))
              ) : (
                <EmptyState title="No category limits yet" />
              )}
            </CardBody>
          </Card>
        </>
      )}
      {history && history.length > 0 && (
        <Card>
          <CardHeader title="Budget performance" description="Limit vs actual spending by month" />
          <CardBody>
            <MultiLine data={history.map((h) => ({ month: h.month, limit: Number(h.limit), spent: Number(h.spent), savings: Number(h.actualSavings) }))} lines={[{ key: 'limit', label: 'Limit', dashed: true, color: '#64748b' }, { key: 'spent', label: 'Spent', color: '#e11d48' }, { key: 'savings', label: 'Saved', color: '#059669' }]} />
          </CardBody>
        </Card>
      )}
      {budget && (
        <>
          <FormModal
            open={adding}
            onClose={() => setAdding(false)}
            title="Add or update a category limit"
            fields={[
              { name: 'categoryId', label: 'Category', type: 'select', required: true, options: categories },
              { name: 'limitAmount', label: 'Monthly limit (₹)', type: 'money', required: true, half: true },
              { name: 'alertThresholdPct', label: 'Alert at (%)', type: 'number', half: true },
            ]}
            initial={{ alertThresholdPct: '80' }}
            onSubmit={async (v) => {
              await api.put(`/budgets/${budget.id}/categories`, { categories: [{ categoryId: v.categoryId, limitAmount: v.limitAmount, alertThresholdPct: Number(v.alertThresholdPct || 80) }] });
              refresh();
            }}
          />
          <FormModal
            open={editTotals}
            onClose={() => setEditTotals(false)}
            title="Budget targets"
            fields={[
              { name: 'totalLimit', label: 'Overall spending limit (₹)', type: 'money', hint: 'Defaults to the sum of category limits.' },
              { name: 'savingsTarget', label: 'Savings target (₹)', type: 'money', half: true },
              { name: 'expectedIncome', label: 'Expected income (₹)', type: 'money', half: true },
            ]}
            initial={{ totalLimit: '', savingsTarget: budget.totals.savingsTarget ?? '' }}
            onSubmit={async (v) => {
              await api.put(`/budgets/${budget.id}`, cleanValues(v, { nullEmpty: true }));
              refresh();
            }}
          />
          <ConfirmDialog open={deleting} onClose={() => setDeleting(false)} title="Delete budget" message={`Delete the ${formatMonth(month)} budget? Your transactions are not affected.`} danger confirmLabel="Delete" onConfirm={async () => { await api.delete(`/budgets/${budget.id}`); refresh(); }} />
        </>
      )}
    </div>
  );
}
