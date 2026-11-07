'use client';
import { ArrowLeftRight, Plus, QrCode, RotateCcw, Search } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { cleanValues, FormModal, type FormValues } from '@/components/form-modal';
import { Badge, Button, Card, DataTable, Field, Input, Modal, Money, PageHeader, Pagination, Select, useToast } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { formatDate, titleCase, todayISO } from '@/lib/format';
import { qs, useApi } from '@/lib/hooks';
import { useAccountOptions, useCategoryOptions, usePaymentMethodOptions } from '@/lib/options';
import type { Paged, Transaction } from '@/lib/types';
import useSWR from 'swr';
import { useAuth } from '@/lib/auth';

function TransactionsInner() {
  const toast = useToast();
  const { status } = useAuth();
  const highlight = useSearchParams().get('highlight');
  const [filters, setFilters] = useState({ search: '', accountId: '', kind: '', from: '', to: '', page: 1 });
  const path = `/transactions${qs({ ...filters, pageSize: 25 })}`;
  const { data, mutate, isLoading } = useSWR<Paged<Transaction>>(status === 'authenticated' ? path : null, (p: string) => api.page<Transaction[]>(p) as Promise<Paged<Transaction>>);
  const accounts = useAccountOptions();
  const expenseCats = useCategoryOptions('expense');
  const incomeCats = useCategoryOptions('income');
  const upiMethods = usePaymentMethodOptions('upi');
  const allMethods = usePaymentMethodOptions();
  const [modal, setModal] = useState<'entry' | 'transfer' | 'upi' | null>(null);
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [qr, setQr] = useState<FormValues | null>(null);
  const { data: detail, mutate: mutateDetail } = useApi<Transaction & { related: Transaction[] }>(selected ? `/transactions/${selected.id}` : null);

  const set = (k: string, v: string) => setFilters({ ...filters, [k]: v, page: 1 });
  const refresh = () => {
    mutate();
    mutateDetail();
  };

  return (
    <div>
      <PageHeader
        title="Transactions"
        description="Your immutable ledger. Mistakes are fixed with reversals and corrections, so history is always preserved."
        actions={
          <>
            <Button variant="secondary" onClick={() => setModal('upi')}><QrCode className="h-4 w-4" /> UPI payment</Button>
            <Button variant="secondary" onClick={() => setModal('transfer')}><ArrowLeftRight className="h-4 w-4" /> Transfer</Button>
            <Button onClick={() => setModal('entry')}><Plus className="h-4 w-4" /> New entry</Button>
          </>
        }
      />
      <Card className="mb-4 p-4">
        <div className="grid gap-3 md:grid-cols-6">
          <div className="relative md:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted" />
            <Input placeholder="Search description, merchant, reference" className="pl-9" value={filters.search} onChange={(e) => set('search', e.target.value)} aria-label="Search" />
          </div>
          <Select value={filters.accountId} onChange={(e) => set('accountId', e.target.value)} aria-label="Account">
            <option value="">All accounts</option>
            {accounts.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </Select>
          <Select value={filters.kind} onChange={(e) => set('kind', e.target.value)} aria-label="Type">
            <option value="">All types</option>
            {['income', 'expense', 'transfer', 'bill_payment', 'loan_repayment', 'refund', 'adjustment', 'investment_buy', 'investment_sell'].map((k) => <option key={k} value={k}>{titleCase(k)}</option>)}
          </Select>
          <Input type="date" value={filters.from} onChange={(e) => set('from', e.target.value)} aria-label="From date" />
          <Input type="date" value={filters.to} onChange={(e) => set('to', e.target.value)} aria-label="To date" />
        </div>
        {data && (
          <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted">
            <span>{data.meta.total} transactions</span>
            <span>In <Money value={data.meta.totals?.credits} tone="positive" /></span>
            <span>Out <Money value={data.meta.totals?.debits} tone="negative" /></span>
            <span>Net <Money value={data.meta.totals?.net} tone="auto" /></span>
          </div>
        )}
      </Card>
      <Card>
        <DataTable
          rows={data?.data}
          loading={isLoading}
          onRowClick={setSelected}
          columns={[
            { key: 'date', header: 'Date', render: (t) => <span className="whitespace-nowrap text-muted">{formatDate(t.occurredOn)}</span> },
            {
              key: 'desc',
              header: 'Description',
              render: (t) => (
                <div className={highlight === t.id ? 'rounded-lg bg-warning/10 p-1' : ''}>
                  <p className="font-medium">{t.description}</p>
                  <p className="text-xs text-muted">{t.merchantName ?? t.counterparty ?? ''}{t.reference ? ` · Ref ${t.reference}` : ''}</p>
                </div>
              ),
            },
            { key: 'cat', header: 'Category', hideOnMobile: true, render: (t) => (t.categoryName ? <span className="inline-flex items-center gap-1.5 text-sm"><span className="h-2 w-2 rounded-full" style={{ background: t.categoryColor ?? 'var(--muted)' }} />{t.categoryName}</span> : <span className="text-muted">—</span>) },
            { key: 'acct', header: 'Account', hideOnMobile: true, render: (t) => <span className="text-sm text-muted">{t.accountName}{t.paymentMethodLabel ? ` · ${t.paymentMethodLabel}` : ''}</span> },
            { key: 'kind', header: 'Type', hideOnMobile: true, render: (t) => <Badge tone={t.direction === 'credit' ? 'positive' : 'neutral'}>{titleCase(t.kind)}</Badge> },
            { key: 'amount', header: 'Amount', align: 'right', render: (t) => <Money value={t.signedAmount} tone="auto" sign className="font-medium" /> },
          ]}
        />
        {data && <Pagination page={data.meta.page} totalPages={data.meta.totalPages} onPage={(p) => setFilters({ ...filters, page: p })} />}
      </Card>

      <FormModal
        open={modal === 'entry'}
        onClose={() => setModal(null)}
        title="New ledger entry"
        description="Leave the category empty to auto-categorise from the description and merchant."
        fields={[
          { name: 'kind', label: 'Type', type: 'select', required: true, half: true, options: [{ value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }, { value: 'refund', label: 'Refund' }, { value: 'fee', label: 'Bank fee' }, { value: 'interest', label: 'Interest received' }, { value: 'adjustment', label: 'Adjustment' }] },
          { name: 'direction', label: 'Direction', type: 'select', half: true, options: [{ value: 'credit', label: 'Money in' }, { value: 'debit', label: 'Money out' }], show: (v) => v.kind === 'adjustment', required: true },
          { name: 'accountId', label: 'Account', type: 'select', required: true, options: accounts, half: true },
          { name: 'amount', label: 'Amount (₹)', type: 'money', required: true, half: true },
          { name: 'occurredOn', label: 'Date', type: 'date', required: true, half: true },
          { name: 'paymentMethodId', label: 'Paid via', type: 'select', options: allMethods, half: true },
          { name: 'description', label: 'Description', required: true },
          { name: 'merchantName', label: 'Merchant / payee', half: true },
          { name: 'reference', label: 'Reference / UTR', half: true },
          { name: 'categoryId', label: 'Category', type: 'select', show: (v) => v.kind === 'expense' || v.kind === 'fee', options: expenseCats },
          { name: 'notes', label: 'Notes', type: 'textarea' },
        ]}
        initial={{ kind: 'expense', occurredOn: todayISO(), accountId: accounts[0]?.value ?? '' }}
        onSubmit={async (v) => {
          const res = await api.post<Transaction>('/transactions', cleanValues(v));
          toast(res.warnings?.length ? `Saved. Note: ${res.warnings[0]}` : 'Entry recorded', res.warnings?.length ? 'info' : 'success');
          mutate();
        }}
      />
      <FormModal
        open={modal === 'transfer'}
        onClose={() => setModal(null)}
        title="Transfer between accounts"
        description="Moving money to a credit card account records a card bill payment."
        fields={[
          { name: 'fromAccountId', label: 'From', type: 'select', required: true, options: accounts, half: true },
          { name: 'toAccountId', label: 'To', type: 'select', required: true, options: accounts, half: true },
          { name: 'amount', label: 'Amount (₹)', type: 'money', required: true, half: true },
          { name: 'occurredOn', label: 'Date', type: 'date', required: true, half: true },
          { name: 'description', label: 'Description' },
          { name: 'reference', label: 'Reference / UTR' },
        ]}
        initial={{ occurredOn: todayISO() }}
        onSubmit={async (v) => {
          await api.post('/transactions/transfer', cleanValues(v));
          toast('Transfer recorded');
          mutate();
        }}
      />
      <FormModal
        open={modal === 'upi'}
        onClose={() => {
          setModal(null);
          setQr(null);
        }}
        title="Record a UPI payment"
        description="Paste a UPI QR payload to pre-fill. Monetra only records payments; it never asks for your UPI PIN or OTP."
        fields={[
          { name: 'direction', label: 'Direction', type: 'select', required: true, half: true, options: [{ value: 'outgoing', label: 'Paid' }, { value: 'incoming', label: 'Received' }] },
          { name: 'accountId', label: 'Bank account', type: 'select', required: true, options: accounts, half: true },
          { name: 'amount', label: 'Amount (₹)', type: 'money', required: true, half: true },
          { name: 'occurredOn', label: 'Date', type: 'date', required: true, half: true },
          { name: 'counterpartyVpa', label: 'UPI ID', half: true, placeholder: 'shop@okaxis' },
          { name: 'counterpartyName', label: 'Name', half: true },
          { name: 'upiRef', label: 'UPI reference (UTR)', half: true },
          { name: 'paymentMethodId', label: 'Your UPI app', type: 'select', options: upiMethods, half: true },
          { name: 'categoryId', label: 'Category', type: 'select', options: [...expenseCats, ...incomeCats] },
          { name: 'note', label: 'Note' },
        ]}
        initial={{ direction: 'outgoing', occurredOn: todayISO(), accountId: accounts[0]?.value ?? '', ...(qr ?? {}) }}
        onSubmit={async (v) => {
          await api.post('/upi/transactions', cleanValues(v));
          toast('UPI payment recorded');
          mutate();
        }}
      >
        <UpiQrParser
          onParsed={(p) => {
            setQr(p);
            setModal(null);
            setTimeout(() => setModal('upi'), 0);
          }}
        />
      </FormModal>

      <Modal open={!!selected} onClose={() => setSelected(null)} title={detail?.description ?? selected?.description ?? ''} description={detail ? `${formatDate(detail.occurredOn)} · ${detail.accountName}` : undefined} size="lg">
        {detail && <TransactionDetail txn={detail} onChanged={refresh} onClose={() => setSelected(null)} expenseCats={expenseCats} incomeCats={incomeCats} />}
      </Modal>
    </div>
  );
}

function UpiQrParser({ onParsed }: { onParsed: (v: FormValues) => void }) {
  const [payload, setPayload] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="rounded-xl border border-dashed border-border p-3">
      <Field label="UPI QR payload (optional)" error={error ?? undefined} hint="Scan the merchant QR with any QR reader and paste the upi://pay… text.">
        <div className="flex gap-2">
          <Input value={payload} onChange={(e) => setPayload(e.target.value)} placeholder="upi://pay?pa=merchant@bank&pn=…" />
          <Button
            variant="secondary"
            onClick={async () => {
              setError(null);
              try {
                const p = await api.post<{ payeeVpa: string; payeeName: string | null; amount: string | null; note: string | null; transactionRef: string | null; suggestedCategoryId: string | null }>('/upi/parse-qr', { payload });
                onParsed({ counterpartyVpa: p.payeeVpa, counterpartyName: p.payeeName ?? '', amount: p.amount ?? '', note: p.note ?? '', upiRef: p.transactionRef ?? '', categoryId: p.suggestedCategoryId ?? '', direction: 'outgoing', occurredOn: todayISO() });
              } catch (err) {
                setError((err as ApiError).message);
              }
            }}
          >
            Read
          </Button>
        </div>
      </Field>
    </div>
  );
}

function TransactionDetail({ txn, onChanged, onClose, expenseCats, incomeCats }: { txn: Transaction & { related: Transaction[] }; onChanged: () => void; onClose: () => void; expenseCats: Array<{ value: string; label: string }>; incomeCats: Array<{ value: string; label: string }> }) {
  const toast = useToast();
  const [mode, setMode] = useState<'view' | 'correct' | 'reverse'>('view');
  const [categoryId, setCategoryId] = useState(txn.categoryId ?? '');
  const [notes, setNotes] = useState(txn.notes ?? '');
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState(txn.amount);
  const [date, setDate] = useState(txn.occurredOn);
  const [busy, setBusy] = useState(false);
  const cats = txn.direction === 'credit' ? incomeCats : expenseCats;
  const canEdit = txn.status === 'posted' && txn.kind !== 'reversal';

  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try {
      await fn();
      toast(msg);
      onChanged();
      setMode('view');
    } catch (err) {
      toast((err as ApiError).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Money value={txn.signedAmount} tone="auto" sign className="text-2xl font-semibold" />
        <Badge>{titleCase(txn.kind)}</Badge>
        {txn.status === 'reversed' && <Badge tone="warning">Reversed</Badge>}
        {txn.metadata?.autoCategory && <Badge tone="accent">Auto: {txn.metadata.autoCategory.explanation}</Badge>}
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div><dt className="text-xs text-muted">Reference</dt><dd>{txn.reference ?? '—'}</dd></div>
        <div><dt className="text-xs text-muted">Counterparty</dt><dd>{txn.counterparty ?? txn.merchantName ?? '—'}</dd></div>
        <div><dt className="text-xs text-muted">Paid via</dt><dd>{txn.paymentMethodLabel ?? '—'}</dd></div>
        <div><dt className="text-xs text-muted">Tags</dt><dd>{txn.tags.length ? txn.tags.join(', ') : '—'}</dd></div>
      </dl>
      {canEdit && (
        <div className="grid gap-3 rounded-xl border border-border p-3 sm:grid-cols-2">
          <Field label="Category">
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">—</option>
              {cats.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </Select>
          </Field>
          <Field label="Notes">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <div className="sm:col-span-2">
            <Button size="sm" variant="secondary" loading={busy} onClick={() => run(() => api.patch(`/transactions/${txn.id}`, { categoryId: categoryId || null, notes }), 'Saved')}>Save annotations</Button>
          </div>
        </div>
      )}
      {mode === 'correct' && (
        <div className="grid gap-3 rounded-xl border border-brand/40 bg-brand-soft/40 p-3 sm:grid-cols-3">
          <Field label="Correct amount"><Input className="num" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label="Correct date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Typo in amount" /></Field>
          <p className="text-xs text-muted sm:col-span-3">The original entry is reversed and a corrected entry is posted. Both stay in your history.</p>
          <div className="sm:col-span-3"><Button size="sm" loading={busy} disabled={reason.length < 3} onClick={() => run(() => api.post(`/transactions/${txn.id}/correct`, { amount, occurredOn: date, reason }), 'Correction posted')}>Post correction</Button></div>
        </div>
      )}
      {mode === 'reverse' && (
        <div className="space-y-3 rounded-xl border border-negative/40 bg-negative/5 p-3">
          <Field label="Why are you reversing this entry?"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Duplicate entry" /></Field>
          <Button size="sm" variant="danger" loading={busy} disabled={reason.length < 3} onClick={() => run(async () => { await api.post(`/transactions/${txn.id}/reverse`, { reason }); onClose(); }, 'Transaction reversed')}>Reverse transaction</Button>
        </div>
      )}
      {txn.related.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium text-muted">Linked entries</p>
          <ul className="space-y-1.5">
            {txn.related.map((r) => (
              <li key={r.id} className="flex justify-between rounded-lg bg-surface-2 px-3 py-2 text-sm">
                <span>{r.description} <span className="text-xs text-muted">({titleCase(r.kind)})</span></span>
                <Money value={r.signedAmount} tone="auto" sign />
              </li>
            ))}
          </ul>
        </div>
      )}
      {canEdit && mode === 'view' && (
        <div className="flex gap-2 border-t border-border pt-3">
          {!txn.transferGroupId || txn.direction === 'debit' ? <Button size="sm" variant="secondary" onClick={() => setMode('correct')}>Correct amount/date</Button> : null}
          <Button size="sm" variant="ghost" onClick={() => setMode('reverse')}><RotateCcw className="h-4 w-4" /> Reverse</Button>
        </div>
      )}
    </div>
  );
}

export default function TransactionsPage() {
  return (
    <Suspense>
      <TransactionsInner />
    </Suspense>
  );
}
