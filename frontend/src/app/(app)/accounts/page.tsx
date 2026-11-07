'use client';
import { CreditCard, Plus, Smartphone, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { cleanValues, ConfirmDialog, FormModal, type FieldDef } from '@/components/form-modal';
import { Badge, Button, Card, CardHeader, DataTable, EmptyState, Money, PageHeader, PageLoader, Progress, StatCard, Tabs, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate, titleCase } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { enumOptions, useAccounts } from '@/lib/options';
import type { Account, PaymentMethod } from '@/lib/types';

const TYPES = ['savings', 'salary', 'current', 'cash', 'wallet', 'credit_card', 'overdraft', 'other'] as const;

const accountFields: FieldDef[] = [
  { name: 'name', label: 'Account name', required: true, placeholder: 'HDFC Savings' },
  { name: 'type', label: 'Type', type: 'select', required: true, options: enumOptions(TYPES), half: true },
  { name: 'nickname', label: 'Nickname', half: true },
  { name: 'institutionName', label: 'Bank / provider', half: true },
  { name: 'accountNumberLast4', label: 'Last 4 digits', half: true, hint: 'Never enter the full account number.' },
  { name: 'ifsc', label: 'IFSC', half: true },
  { name: 'openingBalance', label: 'Opening balance (₹)', type: 'money', half: true, hint: 'Negative for an amount owed on a card.' },
  { name: 'openingDate', label: 'Opening balance date', type: 'date', half: true },
  { name: 'creditLimit', label: 'Credit limit (₹)', type: 'money', half: true, show: (v) => v.type === 'credit_card' || v.type === 'overdraft' },
  { name: 'includeInNetWorth', label: 'Include in net worth', type: 'checkbox' },
];

const pmFields: FieldDef[] = [
  { name: 'type', label: 'Type', type: 'select', required: true, options: enumOptions(['upi', 'debit_card', 'credit_card', 'net_banking', 'wallet', 'cash', 'cheque', 'other']) },
  { name: 'label', label: 'Label', required: true, placeholder: 'GPay, HDFC Debit…' },
  { name: 'upiVpa', label: 'UPI ID', placeholder: 'name@okhdfcbank', show: (v) => v.type === 'upi' },
  { name: 'upiApp', label: 'UPI app', show: (v) => v.type === 'upi', half: true },
  { name: 'cardNetwork', label: 'Card network', type: 'select', options: enumOptions(['visa', 'mastercard', 'rupay', 'amex', 'diners', 'other']), show: (v) => String(v.type).includes('card'), half: true },
  { name: 'cardLast4', label: 'Card last 4 digits', show: (v) => String(v.type).includes('card'), half: true, hint: 'Monetra never stores full card numbers or CVVs.' },
  { name: 'isDefault', label: 'Use as default', type: 'checkbox' },
];

const icon = (type: string) => (type === 'credit_card' ? <CreditCard className="h-4 w-4" /> : type === 'wallet' ? <Smartphone className="h-4 w-4" /> : <Wallet className="h-4 w-4" />);

export default function AccountsPage() {
  const toast = useToast();
  const [tab, setTab] = useState<'accounts' | 'methods'>('accounts');
  const [showClosed, setShowClosed] = useState(false);
  const { data: accounts, mutate, isLoading } = useAccounts(showClosed);
  const { data: summary, mutate: mutateSummary } = useApi<{ totalAvailableBalance: string; creditCardOutstanding: string; netAccountBalance: string; accountCount: number }>('/accounts/summary');
  const { data: methods, mutate: mutateMethods } = useApi<PaymentMethod[]>('/payment-methods');
  const [creating, setCreating] = useState(false);
  const [pmOpen, setPmOpen] = useState(false);
  const [removing, setRemoving] = useState<PaymentMethod | null>(null);

  const refresh = () => {
    mutate();
    mutateSummary();
  };

  return (
    <div>
      <PageHeader
        title="Accounts"
        description="Bank accounts, cash, wallets and cards. Balances are computed from your ledger; nothing is fetched from banks."
        actions={tab === 'accounts' ? <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Add account</Button> : <Button onClick={() => setPmOpen(true)}><Plus className="h-4 w-4" /> Add payment method</Button>}
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Available balance" value={<Money value={summary?.totalAvailableBalance} />} hint="Bank, cash and wallets" />
        <StatCard label="Credit card outstanding" value={<Money value={summary?.creditCardOutstanding} />} tone="negative" />
        <StatCard label="Net across accounts" value={<Money value={summary?.netAccountBalance} />} tone="accent" hint={`${summary?.accountCount ?? 0} active accounts`} />
      </div>
      <div className="mb-4 flex items-center justify-between">
        <Tabs value={tab} onChange={setTab} tabs={[{ value: 'accounts', label: 'Accounts' }, { value: 'methods', label: 'Payment methods' }]} />
        {tab === 'accounts' && (
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Show closed
          </label>
        )}
      </div>

      {tab === 'accounts' ? (
        isLoading ? (
          <PageLoader />
        ) : accounts?.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {accounts.map((a: Account) => (
              <Link key={a.id} href={`/accounts/${a.id}`}>
                <Card className="animate-in h-full p-5 transition hover:-translate-y-0.5 hover:border-brand/40">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="rounded-xl bg-brand-soft p-2 text-brand">{icon(a.type)}</div>
                      <div>
                        <p className="font-medium">{a.name}</p>
                        <p className="text-xs text-muted">{a.institutionName ?? titleCase(a.type)}{a.accountNumberLast4 ? ` ••${a.accountNumberLast4}` : ''}</p>
                      </div>
                    </div>
                    {!a.isActive ? <Badge>Closed</Badge> : <Badge tone="neutral">{a.dataSourceLabel}</Badge>}
                  </div>
                  <Money value={a.balance} tone={Number(a.balance) < 0 ? 'negative' : 'none'} className="mt-4 block text-2xl font-semibold" />
                  {a.creditLimit && (
                    <div className="mt-3">
                      <Progress value={Number(a.utilizationPercent ?? 0)} tone={Number(a.utilizationPercent ?? 0) > 30 ? 'warning' : 'brand'} />
                      <p className="mt-1 text-xs text-muted">{a.utilizationPercent ?? 0}% used · <Money value={a.availableCredit} /> available</p>
                    </div>
                  )}
                  <p className="mt-3 text-xs text-muted">{a.transactionCount} transactions{a.lastTransactionOn ? ` · last ${formatDate(a.lastTransactionOn)}` : ''}</p>
                </Card>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState title="No accounts yet" description="Add your bank accounts, cash and cards to start tracking." action={<Button onClick={() => setCreating(true)}>Add account</Button>} />
        )
      ) : (
        <Card>
          <CardHeader title="Payment methods" description="Only non-secret identifiers are stored: UPI IDs and the last 4 digits of cards." />
          <DataTable
            rows={methods}
            columns={[
              { key: 'label', header: 'Method', render: (p) => <span className="font-medium">{p.label}</span> },
              { key: 'type', header: 'Type', render: (p) => titleCase(p.type) },
              { key: 'id', header: 'Identifier', render: (p) => p.upiVpa ?? (p.cardLast4 ? `${titleCase(p.cardNetwork ?? '')} ••${p.cardLast4}` : '—') },
              { key: 'status', header: 'Status', render: (p) => (p.isDefault ? <Badge tone="brand">Default</Badge> : p.isActive ? <Badge>Active</Badge> : <Badge tone="warning">Inactive</Badge>) },
              { key: 'actions', header: '', align: 'right', render: (p) => <Button size="sm" variant="ghost" onClick={() => setRemoving(p)}>Remove</Button> },
            ]}
            empty={<EmptyState title="No payment methods" description="Add UPI IDs and cards to tag your spending." />}
          />
        </Card>
      )}

      <FormModal
        open={creating}
        onClose={() => setCreating(false)}
        title="Add account"
        description="Manually tracked: Monetra does not connect to your bank."
        fields={accountFields}
        initial={{ type: 'savings', includeInNetWorth: true }}
        onSubmit={async (v) => {
          await api.post('/accounts', cleanValues(v));
          toast('Account added');
          refresh();
        }}
      />
      <FormModal
        open={pmOpen}
        onClose={() => setPmOpen(false)}
        title="Add payment method"
        description="Never enter PINs, CVVs, OTPs or full card numbers."
        fields={pmFields}
        initial={{ type: 'upi' }}
        onSubmit={async (v) => {
          await api.post('/payment-methods', cleanValues(v));
          toast('Payment method added');
          mutateMethods();
        }}
      />
      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        title="Remove payment method"
        message={`Remove ${removing?.label}? If it has transactions it will be deactivated instead.`}
        confirmLabel="Remove"
        danger
        onConfirm={async () => {
          await api.delete(`/payment-methods/${removing!.id}`);
          mutateMethods();
        }}
      />
    </div>
  );
}
