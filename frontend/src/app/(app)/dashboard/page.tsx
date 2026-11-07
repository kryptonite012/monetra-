'use client';
import { ArrowDownRight, ArrowUpRight, Landmark, PiggyBank, Scale, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { CashflowChart, DonutChart, Legend } from '@/components/charts';
import { Badge, Card, CardBody, CardHeader, EmptyState, Money, PageLoader, Progress, StatCard, Tabs } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { formatDate, formatMoney, formatPercent, titleCase } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import type { Transaction } from '@/lib/types';

interface Dashboard {
  period: { type: string; from: string; to: string };
  balances: { totalAvailableBalance: string; creditCardOutstanding: string; accountCount: number };
  totals: { income: string; expenses: string; netCashFlow: string; savingsRatePercent: string | null; debtToIncomePercent: string | null };
  netWorth: { value: string; totalAssets: string; totalLiabilities: string; changeSinceLastMonth: string | null };
  liabilities: { totalOutstanding: string; loanOutstanding: string; monthlyEmi: string; nextEmis: Array<{ loanId: string; name: string; dueDate: string; emiAmount: string; overdue: boolean }> };
  upcomingBills: Array<{ id: string; kind: string; name: string; dueDate: string; amount: string | null; overdue: boolean; daysUntilDue: number }>;
  recentTransactions: Transaction[];
  charts: { cashflow: Array<{ month: string; income: string; expenses: string; net: string }>; spendingByCategory: Array<{ name: string; total: string; percent: string; color: string | null }> };
  goals: Array<{ id: string; name: string; completionPercent: string; savedAmount: string; targetAmount: string; estimatedCompletionDate: string | null }>;
  healthScore: { score: number; grade: string; components: Array<{ key: string; label: string; score: number; max: number; value: string | null; explanation: string }>; focusArea: { label: string; explanation: string } | null; methodology: string };
}

function HealthGauge({ score }: { score: number }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const color = score >= 80 ? 'var(--positive)' : score >= 45 ? 'var(--warning)' : 'var(--negative)';
  return (
    <svg viewBox="0 0 120 120" className="h-32 w-32" role="img" aria-label={`Health score ${score} out of 100`}>
      <circle cx="60" cy="60" r={r} fill="none" stroke="var(--surface-3)" strokeWidth="10" />
      <circle cx="60" cy="60" r={r} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} transform="rotate(-90 60 60)" style={{ transition: 'stroke-dashoffset .8s ease' }} />
      <text x="60" y="58" textAnchor="middle" className="num" fontSize="28" fontWeight="600" fill="var(--text)">{score}</text>
      <text x="60" y="76" textAnchor="middle" fontSize="10" fill="var(--muted)">out of 100</text>
    </svg>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [period, setPeriod] = useState<'month' | 'quarter' | 'year'>('month');
  const { data, isLoading } = useApi<Dashboard>(`/dashboard?period=${period}`);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {greeting}, {user?.profile?.displayName || user?.profile?.fullName?.split(' ')[0]}
          </h1>
          <p className="mt-1 text-sm text-muted">Here&apos;s your financial picture. Balances are computed from the records you enter.</p>
        </div>
        <Tabs value={period} onChange={setPeriod} tabs={[{ value: 'month', label: 'This month' }, { value: 'quarter', label: 'Quarter' }, { value: 'year', label: 'Year' }]} />
      </div>

      {isLoading || !data ? (
        <PageLoader label="Crunching your numbers" />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Available balance" value={<Money value={data.balances.totalAvailableBalance} />} hint={`${data.balances.accountCount} accounts · ${formatMoney(data.balances.creditCardOutstanding)} card dues`} icon={<Wallet className="h-4 w-4" />} />
            <StatCard label="Income" value={<Money value={data.totals.income} />} hint={`${formatDate(data.period.from)} – ${formatDate(data.period.to)}`} icon={<ArrowUpRight className="h-4 w-4" />} tone="positive" />
            <StatCard label="Expenses" value={<Money value={data.totals.expenses} />} hint={`Net cash flow ${formatMoney(data.totals.netCashFlow, { sign: true })}`} icon={<ArrowDownRight className="h-4 w-4" />} tone="negative" />
            <StatCard label="Savings rate" value={<span className="num">{formatPercent(data.totals.savingsRatePercent)}</span>} hint={data.totals.debtToIncomePercent ? `Debt-to-income ${formatPercent(data.totals.debtToIncomePercent)}` : 'Share of income kept'} icon={<PiggyBank className="h-4 w-4" />} tone="accent" />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title="Cash flow" description="Income vs spending with net savings" />
              <CardBody>{data.charts.cashflow.some((c) => Number(c.income) || Number(c.expenses)) ? <CashflowChart data={data.charts.cashflow} /> : <EmptyState title="No activity yet" description="Record income and expenses to see your cash flow." />}</CardBody>
            </Card>
            <Card>
              <CardHeader title="Financial health" description={data.healthScore.grade} action={<Badge tone="brand">Explainable</Badge>} />
              <CardBody className="flex flex-col items-center">
                <HealthGauge score={data.healthScore.score} />
                <ul className="mt-3 w-full space-y-2">
                  {data.healthScore.components.map((c) => (
                    <li key={c.key} title={c.explanation}>
                      <div className="flex justify-between text-xs">
                        <span className="text-muted">{c.label}</span>
                        <span className="num">{c.score}/{c.max}</span>
                      </div>
                      <Progress value={(c.score / c.max) * 100} tone={c.score / c.max >= 0.7 ? 'positive' : c.score / c.max >= 0.4 ? 'warning' : 'negative'} className="mt-1 h-1.5" />
                    </li>
                  ))}
                </ul>
                {data.healthScore.focusArea && <p className="mt-3 text-xs text-muted"><span className="font-medium text-text">Focus: </span>{data.healthScore.focusArea.explanation}</p>}
              </CardBody>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader title="Spending by category" />
              <CardBody>
                {data.charts.spendingByCategory.length ? (
                  <>
                    <DonutChart data={data.charts.spendingByCategory.map((c) => ({ name: c.name, value: Number(c.total), color: c.color }))} height={180} />
                    <Legend items={data.charts.spendingByCategory.slice(0, 6).map((c) => ({ name: c.name, value: c.total, color: c.color, extra: `${c.percent}%` }))} />
                  </>
                ) : (
                  <EmptyState title="No spending this period" />
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Net worth" description="Assets minus liabilities" action={<Link href="/assets" className="text-xs text-brand hover:underline">Details</Link>} />
              <CardBody className="space-y-4">
                <div>
                  <Money value={data.netWorth.value} className="text-3xl font-semibold tracking-tight" />
                  {data.netWorth.changeSinceLastMonth && <p className={cn('mt-1 text-xs', Number(data.netWorth.changeSinceLastMonth) >= 0 ? 'text-positive' : 'text-negative')}>{formatMoney(data.netWorth.changeSinceLastMonth, { sign: true })} since last month</p>}
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-xl bg-surface-2 p-3"><p className="text-xs text-muted">Assets</p><Money value={data.netWorth.totalAssets} className="font-medium" /></div>
                  <div className="rounded-xl bg-surface-2 p-3"><p className="text-xs text-muted">Liabilities</p><Money value={data.netWorth.totalLiabilities} className="font-medium" /></div>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-border p-3 text-sm">
                  <span className="flex items-center gap-2 text-muted"><Landmark className="h-4 w-4" /> Loans outstanding</span>
                  <Money value={data.liabilities.loanOutstanding} />
                </div>
                <div className="flex items-center justify-between rounded-xl border border-border p-3 text-sm">
                  <span className="flex items-center gap-2 text-muted"><Scale className="h-4 w-4" /> Monthly EMIs</span>
                  <Money value={data.liabilities.monthlyEmi} />
                </div>
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Upcoming payments" description="Next 14 days" action={<Link href="/bills" className="text-xs text-brand hover:underline">All bills</Link>} />
              <CardBody className="space-y-2">
                {[...data.liabilities.nextEmis.map((e) => ({ id: e.loanId, name: `EMI · ${e.name}`, dueDate: e.dueDate, amount: e.emiAmount, overdue: e.overdue })), ...data.upcomingBills].sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 6).map((b) => (
                  <div key={`${b.id}-${b.dueDate}`} className="flex items-center justify-between rounded-xl border border-border px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{b.name}</p>
                      <p className={cn('text-xs', b.overdue ? 'text-negative' : 'text-muted')}>{b.overdue ? 'Overdue · ' : ''}{formatDate(b.dueDate)}</p>
                    </div>
                    {b.amount ? <Money value={b.amount} /> : <Badge>variable</Badge>}
                  </div>
                ))}
                {!data.upcomingBills.length && !data.liabilities.nextEmis.length && <EmptyState title="Nothing due soon" />}
              </CardBody>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title="Recent transactions" action={<Link href="/transactions" className="text-xs text-brand hover:underline">View all</Link>} />
              <CardBody className="divide-y divide-border/70 py-2">
                {data.recentTransactions.length ? (
                  data.recentTransactions.map((t) => (
                    <div key={t.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="h-8 w-1.5 shrink-0 rounded-full" style={{ background: t.categoryColor ?? 'var(--surface-3)' }} />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{t.description}</p>
                          <p className="text-xs text-muted">{formatDate(t.occurredOn)} · {t.categoryName ?? titleCase(t.kind)} · {t.accountName}</p>
                        </div>
                      </div>
                      <Money value={t.signedAmount} tone="auto" sign className="text-sm font-medium" />
                    </div>
                  ))
                ) : (
                  <EmptyState title="No transactions yet" description="Add income or an expense to get started." />
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Savings goals" action={<Link href="/goals" className="text-xs text-brand hover:underline">Manage</Link>} />
              <CardBody className="space-y-4">
                {data.goals.length ? (
                  data.goals.map((g) => (
                    <div key={g.id}>
                      <div className="flex justify-between text-sm">
                        <span className="font-medium">{g.name}</span>
                        <span className="num text-muted">{Number(g.completionPercent).toFixed(0)}%</span>
                      </div>
                      <Progress value={Number(g.completionPercent)} className="mt-1.5" />
                      <p className="mt-1 text-xs text-muted">{formatMoney(g.savedAmount)} of {formatMoney(g.targetAmount)}{g.estimatedCompletionDate ? ` · est. ${formatDate(g.estimatedCompletionDate)}` : ''}</p>
                    </div>
                  ))
                ) : (
                  <EmptyState title="No goals yet" description="Set a target like an emergency fund." />
                )}
              </CardBody>
            </Card>
          </div>
          <p className="text-center text-xs text-muted">{data.healthScore.methodology} Monetra is not connected to your bank; figures reflect what you record.</p>
        </>
      )}
    </div>
  );
}
