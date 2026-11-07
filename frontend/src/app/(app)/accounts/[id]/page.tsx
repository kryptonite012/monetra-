'use client';
import { ArrowLeft, Download, Scale } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { CashflowChart } from '@/components/charts';
import { cleanValues, ConfirmDialog, FormModal } from '@/components/form-modal';
import { Badge, Button, Card, CardBody, CardHeader, DataTable, Field, Input, Money, PageHeader, PageLoader, StatCard, useToast } from '@/components/ui';
import { api, downloadFile } from '@/lib/api';
import { formatDate, titleCase, todayISO } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import type { Account } from '@/lib/types';

interface Statement {
  openingBalance: string;
  closingBalance: string;
  totalCredits: string;
  totalDebits: string;
  entries: Array<{ id: string; occurredOn: string; description: string; reference: string | null; direction: string; amount: string; runningBalance: string; status: string; categoryName: string | null }>;
}

export default function AccountDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const today = todayISO();
  const [range, setRange] = useState({ from: `${today.slice(0, 7)}-01`, to: today });
  const { data: account, mutate } = useApi<Account & { monthly: Array<{ month: string; inflow: string; outflow: string; net: string }> }>(`/accounts/${id}`);
  const { data: statement } = useApi<Statement>(`/accounts/${id}/statement?from=${range.from}&to=${range.to}`);
  const { data: recons, mutate: mutateRecons } = useApi<Array<{ id: string; asOfDate: string; balance: string; computedBalance: string; difference: string; reconciled: boolean }>>(`/accounts/${id}/reconciliations`);
  const [editing, setEditing] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [closing, setClosing] = useState(false);

  if (!account) return <PageLoader />;

  return (
    <div>
      <Link href="/accounts" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-text"><ArrowLeft className="h-4 w-4" /> Accounts</Link>
      <PageHeader
        title={account.name}
        description={`${account.institutionName ?? titleCase(account.type)}${account.accountNumberLast4 ? ` ••${account.accountNumberLast4}` : ''} · ${account.dataSourceLabel}`}
        actions={
          <>
            <Button variant="secondary" onClick={() => setReconciling(true)}><Scale className="h-4 w-4" /> Reconcile</Button>
            <Button variant="secondary" onClick={() => setEditing(true)}>Edit</Button>
            {account.isActive ? (
              <Button variant="ghost" onClick={() => setClosing(true)}>Close account</Button>
            ) : (
              <Button variant="ghost" onClick={async () => { await api.post(`/accounts/${id}/reopen`); mutate(); }}>Reopen</Button>
            )}
          </>
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <StatCard label="Current balance" value={<Money value={account.balance} />} />
        <StatCard label="Opening balance" value={<Money value={account.openingBalance} />} hint={formatDate(account.openingDate)} tone="accent" />
        <StatCard label="Transactions" value={<span className="num">{account.transactionCount}</span>} hint={account.lastTransactionOn ? `Last on ${formatDate(account.lastTransactionOn)}` : 'None yet'} />
        {account.creditLimit ? <StatCard label="Available credit" value={<Money value={account.availableCredit} />} hint={`${account.utilizationPercent ?? 0}% utilised`} tone="warning" /> : <StatCard label="Status" value={account.isActive ? 'Active' : 'Closed'} />}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Last 6 months" description="Money in vs out" />
          <CardBody>
            <CashflowChart data={account.monthly.map((m) => ({ month: m.month, income: m.inflow, expenses: m.outflow, net: m.net }))} height={220} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Reconciliation history" description="Statement vs computed balance" />
          <CardBody className="space-y-2">
            {recons?.length ? (
              recons.map((r) => (
                <div key={r.id} className="flex items-center justify-between rounded-xl border border-border px-3 py-2 text-sm">
                  <div>
                    <p className="font-medium">{formatDate(r.asOfDate)}</p>
                    <p className="text-xs text-muted">Statement <Money value={r.balance} /></p>
                  </div>
                  {Number(r.difference) === 0 ? <Badge tone="positive">Matched</Badge> : r.reconciled ? <Badge tone="accent">Adjusted</Badge> : <Badge tone="warning">Off by <Money value={r.difference} /></Badge>}
                </div>
              ))
            ) : (
              <p className="text-sm text-muted">Compare with your bank statement to catch missing entries.</p>
            )}
          </CardBody>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader
          title="Statement"
          description={statement ? `Opening ${Number(statement.openingBalance).toLocaleString('en-IN')} · Closing ${Number(statement.closingBalance).toLocaleString('en-IN')}` : undefined}
          action={
            <div className="flex flex-wrap items-end gap-2">
              <Field label="From"><Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} className="h-8" /></Field>
              <Field label="To"><Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} className="h-8" /></Field>
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  const r = await api.post<{ id: string }>('/reports', { reportType: 'account_statement', accountId: id, periodStart: range.from, periodEnd: range.to, format: 'pdf' });
                  await downloadFile(`/reports/${r.id}/download`, 'statement.pdf');
                }}
              >
                <Download className="h-4 w-4" /> PDF
              </Button>
            </div>
          }
        />
        <DataTable
          rows={statement?.entries}
          loading={!statement}
          columns={[
            { key: 'date', header: 'Date', render: (e) => formatDate(e.occurredOn) },
            { key: 'description', header: 'Description', render: (e) => <span className={e.status === 'reversed' ? 'text-muted line-through' : ''}>{e.description}</span> },
            { key: 'ref', header: 'Reference', hideOnMobile: true, render: (e) => <span className="text-xs text-muted">{e.reference ?? ''}</span> },
            { key: 'amount', header: 'Amount', align: 'right', render: (e) => <Money value={e.direction === 'credit' ? e.amount : `-${e.amount}`} tone="auto" sign /> },
            { key: 'balance', header: 'Balance', align: 'right', render: (e) => <Money value={e.runningBalance} /> },
          ]}
        />
      </Card>

      <FormModal
        open={editing}
        onClose={() => setEditing(false)}
        title="Edit account"
        fields={[
          { name: 'name', label: 'Name', required: true },
          { name: 'nickname', label: 'Nickname', half: true },
          { name: 'institutionName', label: 'Bank / provider', half: true },
          { name: 'accountNumberLast4', label: 'Last 4 digits', half: true },
          { name: 'ifsc', label: 'IFSC', half: true },
          ...(account.creditLimit !== null || account.type === 'credit_card' ? [{ name: 'creditLimit', label: 'Credit limit (₹)', type: 'money' as const }] : []),
          { name: 'notes', label: 'Notes', type: 'textarea' },
          { name: 'includeInNetWorth', label: 'Include in net worth', type: 'checkbox' },
        ]}
        initial={{ name: account.name, nickname: account.nickname ?? '', institutionName: account.institutionName ?? '', accountNumberLast4: account.accountNumberLast4 ?? '', ifsc: account.ifsc ?? '', creditLimit: account.creditLimit ?? '', notes: account.notes ?? '', includeInNetWorth: account.includeInNetWorth }}
        onSubmit={async (v) => {
          await api.patch(`/accounts/${id}`, cleanValues(v, { nullEmpty: true }));
          toast('Account updated');
          mutate();
        }}
      />
      <FormModal
        open={reconciling}
        onClose={() => setReconciling(false)}
        title="Reconcile with statement"
        description="Enter the closing balance printed on your bank statement. Differences can be posted as an auditable adjustment; history is never edited."
        fields={[
          { name: 'asOfDate', label: 'Statement date', type: 'date', required: true, half: true },
          { name: 'statementBalance', label: 'Statement balance (₹)', type: 'money', required: true, half: true },
          { name: 'postAdjustment', label: 'Post an adjustment for any difference', type: 'checkbox' },
          { name: 'note', label: 'Note', type: 'textarea' },
        ]}
        initial={{ asOfDate: today }}
        submitLabel="Reconcile"
        onSubmit={async (v) => {
          const r = await api.post<{ status: string; difference: string }>(`/accounts/${id}/reconcile`, cleanValues(v));
          toast(r.status === 'matched' ? 'Balances match 🎉' : r.status === 'adjusted' ? 'Adjustment posted' : `Off by ₹${r.difference}`, r.status === 'mismatch' ? 'info' : 'success');
          mutate();
          mutateRecons();
        }}
      />
      <ConfirmDialog
        open={closing}
        onClose={() => setClosing(false)}
        title="Close account"
        message="Closing records the current balance and blocks new transactions. You can reopen it later."
        confirmLabel="Close account"
        onConfirm={async () => {
          await api.post(`/accounts/${id}/close`, { force: true });
          toast('Account closed');
          router.push('/accounts');
        }}
      />
    </div>
  );
}
