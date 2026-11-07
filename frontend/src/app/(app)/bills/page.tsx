'use client';
import { Plus } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { cleanValues, ConfirmDialog, FormModal } from '@/components/form-modal';
import { Badge, Button, Card, CardBody, CardHeader, DataTable, EmptyState, Modal, Money, PageHeader, StatCard, Tabs, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate, formatMoney, titleCase, todayISO } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { enumOptions, useAccountOptions, useAccounts, useCategoryOptions, usePaymentMethodOptions } from '@/lib/options';

interface Bill {
  id: string;
  name: string;
  biller: string | null;
  billType: string;
  amountType: string;
  expectedAmount: string | null;
  frequency: string;
  nextDueDate: string;
  daysUntilDue: number;
  overdue: boolean;
  dueSoon: boolean;
  autoPay: boolean;
  defaultAccountId: string | null;
  status: string;
}
interface Sub {
  id: string;
  name: string;
  provider: string | null;
  plan: string | null;
  amount: string;
  billingCycle: string;
  nextRenewalDate: string;
  monthlyEquivalent: string;
  daysUntilDue: number;
  dueSoon: boolean;
  lastUsedOn: string | null;
  status: string;
  defaultAccountId: string | null;
}

const BILL_TYPES = ['electricity', 'water', 'gas', 'internet', 'mobile', 'dth', 'rent', 'insurance', 'maintenance', 'education', 'credit_card', 'tax', 'other'] as const;

function dueBadge(d: { overdue?: boolean; dueSoon: boolean; daysUntilDue: number }) {
  if (d.overdue) return <Badge tone="negative">Overdue</Badge>;
  if (d.daysUntilDue === 0) return <Badge tone="warning">Due today</Badge>;
  if (d.dueSoon) return <Badge tone="warning">In {d.daysUntilDue}d</Badge>;
  return <Badge>In {d.daysUntilDue}d</Badge>;
}

function BillsInner() {
  const toast = useToast();
  const initialTab = useSearchParams().get('tab') === 'subscriptions' ? 'subscriptions' : 'bills';
  const [tab, setTab] = useState<'bills' | 'subscriptions'>(initialTab);
  const accounts = useAccountOptions();
  const { data: allAccounts } = useAccounts();
  const cardAccounts = (allAccounts ?? []).filter((a) => a.type === 'credit_card').map((a) => ({ value: a.id, label: a.name }));
  const categories = useCategoryOptions('expense');
  const methods = usePaymentMethodOptions();
  const { data: bills, mutate: mutateBills } = useApi<Bill[]>('/bills');
  const { data: subs, mutate: mutateSubs } = useApi<Sub[]>('/subscriptions');
  const { data: subSummary, mutate: mutateSummary } = useApi<{ monthlyCost: string; yearlyCost: string; potentialMonthlySavings: string; possiblyUnused: Array<{ id: string; name: string; monthlyCost: string; reason: string }> }>('/subscriptions/summary');
  const { data: upcoming, mutate: mutateUpcoming } = useApi<{ totalExpected: string; overdueCount: number; items: unknown[] }>('/bills/upcoming?days=30');
  const [modal, setModal] = useState<'bill' | 'sub' | null>(null);
  const [payingBill, setPayingBill] = useState<Bill | null>(null);
  const [payingSub, setPayingSub] = useState<Sub | null>(null);
  const [history, setHistory] = useState<{ kind: 'bills' | 'subscriptions'; id: string; name: string } | null>(null);
  const { data: payments } = useApi<Array<{ id: string; amount: string; paidOn: string; periodDueDate: string | null }>>(history ? `/${history.kind}/${history.id}/payments` : null);
  const [deleting, setDeleting] = useState<{ kind: 'bills' | 'subscriptions'; id: string; name: string } | null>(null);
  const refresh = () => {
    mutateBills();
    mutateSubs();
    mutateSummary();
    mutateUpcoming();
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Bills & subscriptions" description="Electricity, rent, insurance, OTT and every other recurring payment, with reminders before they are due." actions={<Button onClick={() => setModal(tab === 'bills' ? 'bill' : 'sub')}><Plus className="h-4 w-4" /> Add {tab === 'bills' ? 'bill' : 'subscription'}</Button>} />
      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard label="Due in 30 days" value={<Money value={upcoming?.totalExpected} />} hint={`${upcoming?.items.length ?? 0} payments`} tone="warning" />
        <StatCard label="Overdue" value={<span className="num">{upcoming?.overdueCount ?? 0}</span>} tone="negative" />
        <StatCard label="Subscriptions / month" value={<Money value={subSummary?.monthlyCost} />} hint={`${formatMoney(subSummary?.yearlyCost)} a year`} tone="accent" />
        <StatCard label="Possible savings" value={<Money value={subSummary?.potentialMonthlySavings} />} hint="From subscriptions you may not use" tone="positive" />
      </div>
      {subSummary?.possiblyUnused.length ? (
        <Card className="border-accent/30 bg-accent/5">
          <CardHeader title="Do you still use these?" description="No usage recorded for over 60 days." />
          <CardBody className="flex flex-wrap gap-2">
            {subSummary.possiblyUnused.map((u) => (
              <span key={u.id} className="rounded-xl border border-border bg-surface px-3 py-1.5 text-sm">{u.name} · <Money value={u.monthlyCost} />/mo</span>
            ))}
          </CardBody>
        </Card>
      ) : null}
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'bills', label: 'Bills', count: bills?.length }, { value: 'subscriptions', label: 'Subscriptions', count: subs?.length }]} />
      <Card>
        {tab === 'bills' ? (
          <DataTable
            rows={bills}
            loading={!bills}
            columns={[
              { key: 'name', header: 'Bill', render: (b) => <div><p className="font-medium">{b.name}</p><p className="text-xs text-muted">{titleCase(b.billType)}{b.biller ? ` · ${b.biller}` : ''} · {titleCase(b.frequency)}{b.autoPay ? ' · auto-pay' : ''}</p></div> },
              { key: 'due', header: 'Next due', render: (b) => <div className="flex items-center gap-2">{formatDate(b.nextDueDate)} {dueBadge(b)}</div> },
              { key: 'amt', header: 'Amount', align: 'right', render: (b) => (b.expectedAmount ? <Money value={b.expectedAmount} /> : <Badge>variable</Badge>) },
              { key: 'x', header: '', align: 'right', render: (b) => <div className="flex justify-end gap-1"><Button size="sm" onClick={() => setPayingBill(b)}>Pay</Button><Button size="sm" variant="ghost" onClick={() => setHistory({ kind: 'bills', id: b.id, name: b.name })}>History</Button><Button size="sm" variant="ghost" onClick={() => setDeleting({ kind: 'bills', id: b.id, name: b.name })}>Delete</Button></div> },
            ]}
            empty={<EmptyState title="No bills yet" description="Add electricity, rent, internet or insurance to get due-date reminders." />}
          />
        ) : (
          <DataTable
            rows={subs}
            loading={!subs}
            columns={[
              { key: 'name', header: 'Subscription', render: (s) => <div><p className="font-medium">{s.name}{s.status === 'cancelled' && <Badge className="ml-2">Cancelled</Badge>}</p><p className="text-xs text-muted">{s.provider ?? ''}{s.plan ? ` · ${s.plan}` : ''} · {titleCase(s.billingCycle)}{s.lastUsedOn ? ` · used ${formatDate(s.lastUsedOn)}` : ''}</p></div> },
              { key: 'renew', header: 'Renews', render: (s) => (s.status === 'cancelled' ? '—' : <div className="flex items-center gap-2">{formatDate(s.nextRenewalDate)} {dueBadge(s)}</div>) },
              { key: 'amt', header: 'Price', align: 'right', render: (s) => <div><Money value={s.amount} /><p className="text-xs text-muted"><Money value={s.monthlyEquivalent} />/mo</p></div> },
              {
                key: 'x',
                header: '',
                align: 'right',
                render: (s) =>
                  s.status === 'cancelled' ? null : (
                    <div className="flex justify-end gap-1">
                      <Button size="sm" onClick={() => setPayingSub(s)}>Renew</Button>
                      <Button size="sm" variant="ghost" onClick={async () => { await api.post(`/subscriptions/${s.id}/used`, {}); toast('Usage noted'); refresh(); }}>Used today</Button>
                      <Button size="sm" variant="ghost" onClick={async () => { await api.post(`/subscriptions/${s.id}/cancel`, {}); toast(`${s.name} marked cancelled`); refresh(); }}>Cancel</Button>
                    </div>
                  ),
              },
            ]}
            empty={<EmptyState title="No subscriptions yet" description="Track Netflix, Spotify, cloud storage and memberships." />}
          />
        )}
      </Card>

      <FormModal
        open={modal === 'bill'}
        onClose={() => setModal(null)}
        title="Add bill"
        fields={[
          { name: 'name', label: 'Name', required: true, placeholder: 'Electricity' },
          { name: 'billType', label: 'Type', type: 'select', required: true, options: enumOptions(BILL_TYPES), half: true },
          { name: 'biller', label: 'Biller', half: true, placeholder: 'BESCOM' },
          { name: 'amountType', label: 'Amount', type: 'select', required: true, half: true, options: [{ value: 'variable', label: 'Varies each time' }, { value: 'fixed', label: 'Fixed' }] },
          { name: 'expectedAmount', label: 'Expected amount (₹)', type: 'money', half: true },
          { name: 'frequency', label: 'Frequency', type: 'select', required: true, half: true, options: enumOptions(['monthly', 'bimonthly', 'quarterly', 'half_yearly', 'yearly']) },
          { name: 'nextDueDate', label: 'Next due date', type: 'date', required: true, half: true },
          { name: 'consumerNumber', label: 'Consumer / account number', half: true },
          { name: 'reminderDaysBefore', label: 'Remind me (days before)', type: 'number', half: true },
          { name: 'defaultAccountId', label: 'Usually paid from', type: 'select', options: accounts, half: true },
          { name: 'paymentMethodId', label: 'Payment method', type: 'select', options: methods, half: true },
          { name: 'autoPay', label: 'Auto-pay is set up with the biller', type: 'checkbox' },
        ]}
        initial={{ billType: 'electricity', amountType: 'variable', frequency: 'monthly', nextDueDate: todayISO(), reminderDaysBefore: '3' }}
        onSubmit={async (v) => {
          const body = cleanValues(v);
          if (body.reminderDaysBefore) body.reminderDaysBefore = Number(body.reminderDaysBefore);
          await api.post('/bills', body);
          toast('Bill added');
          refresh();
        }}
      />
      <FormModal
        open={modal === 'sub'}
        onClose={() => setModal(null)}
        title="Add subscription"
        fields={[
          { name: 'name', label: 'Name', required: true, placeholder: 'Netflix' },
          { name: 'provider', label: 'Provider', half: true },
          { name: 'plan', label: 'Plan', half: true },
          { name: 'amount', label: 'Price (₹)', type: 'money', required: true, half: true },
          { name: 'billingCycle', label: 'Billed', type: 'select', required: true, half: true, options: enumOptions(['weekly', 'monthly', 'quarterly', 'half_yearly', 'yearly']) },
          { name: 'nextRenewalDate', label: 'Next renewal', type: 'date', required: true, half: true },
          { name: 'startDate', label: 'Started on', type: 'date', half: true },
          { name: 'categoryId', label: 'Category', type: 'select', options: categories, half: true },
          { name: 'defaultAccountId', label: 'Paid from', type: 'select', options: accounts, half: true },
          { name: 'autoRenew', label: 'Auto-renews', type: 'checkbox' },
        ]}
        initial={{ billingCycle: 'monthly', nextRenewalDate: todayISO(), autoRenew: true }}
        onSubmit={async (v) => {
          await api.post('/subscriptions', cleanValues(v));
          toast('Subscription added');
          refresh();
        }}
      />
      <FormModal
        open={!!payingBill}
        onClose={() => setPayingBill(null)}
        title={`Pay ${payingBill?.name ?? ''}`}
        description="Records the payment as an expense and moves the due date forward."
        fields={[
          { name: 'amount', label: 'Amount paid (₹)', type: 'money', required: true, half: true },
          { name: 'paidOn', label: 'Paid on', type: 'date', required: true, half: true },
          { name: 'accountId', label: 'Paid from', type: 'select', required: true, options: accounts, half: true },
          ...(payingBill?.billType === 'credit_card' ? [{ name: 'cardAccountId', label: 'Card being paid', type: 'select' as const, required: true, options: cardAccounts, half: true }] : [{ name: 'paymentMethodId', label: 'Payment method', type: 'select' as const, options: methods, half: true }]),
          { name: 'reference', label: 'Reference / transaction ID' },
        ]}
        initial={{ amount: payingBill?.expectedAmount ?? '', paidOn: todayISO(), accountId: payingBill?.defaultAccountId ?? accounts[0]?.value ?? '' }}
        onSubmit={async (v) => {
          await api.post(`/bills/${payingBill!.id}/pay`, cleanValues(v));
          toast('Bill paid');
          refresh();
        }}
      />
      <FormModal
        open={!!payingSub}
        onClose={() => setPayingSub(null)}
        title={`Renew ${payingSub?.name ?? ''}`}
        fields={[
          { name: 'amount', label: 'Amount (₹)', type: 'money', required: true, half: true },
          { name: 'paidOn', label: 'Paid on', type: 'date', required: true, half: true },
          { name: 'accountId', label: 'Paid from', type: 'select', required: true, options: accounts },
        ]}
        initial={{ amount: payingSub?.amount ?? '', paidOn: todayISO(), accountId: payingSub?.defaultAccountId ?? accounts[0]?.value ?? '' }}
        onSubmit={async (v) => {
          await api.post(`/subscriptions/${payingSub!.id}/pay`, cleanValues(v));
          toast('Renewal recorded');
          refresh();
        }}
      />
      <Modal open={!!history} onClose={() => setHistory(null)} title={`${history?.name ?? ''} payment history`} size="md">
        <ul className="divide-y divide-border/70">
          {payments?.map((p) => (
            <li key={p.id} className="flex justify-between py-2 text-sm"><span>{formatDate(p.paidOn)} <span className="text-xs text-muted">{p.periodDueDate ? `for due ${formatDate(p.periodDueDate)}` : ''}</span></span><Money value={p.amount} /></li>
          ))}
          {payments && !payments.length && <li className="py-2 text-sm text-muted">No payments recorded yet.</li>}
        </ul>
      </Modal>
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} title="Delete" message={`Delete ${deleting?.name}? Payments already recorded stay in your ledger.`} danger confirmLabel="Delete" onConfirm={async () => { await api.delete(`/${deleting!.kind}/${deleting!.id}`); refresh(); }} />
    </div>
  );
}

export default function BillsPage() {
  return (
    <Suspense>
      <BillsInner />
    </Suspense>
  );
}
