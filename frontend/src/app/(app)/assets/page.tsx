'use client';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { TrendLine } from '@/components/charts';
import { cleanValues, ConfirmDialog, FormModal } from '@/components/form-modal';
import { Badge, Button, Card, CardBody, CardHeader, DataTable, EmptyState, Money, PageHeader, StatCard, Tabs, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate, titleCase, todayISO } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { enumOptions, useAccountOptions } from '@/lib/options';

interface NetWorth {
  totalAssets: string;
  totalLiabilities: string;
  netWorth: string;
  composition: Array<{ key: string; label: string; value: string; side: 'asset' | 'liability' }>;
  valuationNote: string;
}
interface Asset {
  id: string;
  name: string;
  assetType: string;
  purchaseValue: string | null;
  purchaseDate: string | null;
  currentValue: string;
  valuationDate: string;
  valuationSource: string;
  gain: string | null;
  gainPercent: string | null;
  disposedOn: string | null;
}
interface Liability {
  id: string;
  name: string;
  liabilityType: string;
  counterparty: string | null;
  amountOutstanding: string;
  dueDate: string | null;
  status: string;
  overdue: boolean;
}

const ASSET_TYPES = ['real_estate', 'land', 'vehicle', 'gold', 'jewellery', 'business', 'collectible', 'electronics', 'receivable', 'other'] as const;
const LIAB_TYPES = ['personal_borrowing', 'family_loan', 'tax_due', 'payable', 'security_deposit', 'bnpl', 'other'] as const;

export default function AssetsPage() {
  const toast = useToast();
  const accounts = useAccountOptions();
  const [tab, setTab] = useState<'assets' | 'liabilities'>('assets');
  const { data: nw, mutate: mutateNw } = useApi<NetWorth>('/net-worth');
  const { data: history } = useApi<{ points: Array<{ month: string; netWorth: string }>; change: string }>('/net-worth/history?months=12');
  const { data: assets, mutate: mutateAssets } = useApi<Asset[]>('/assets');
  const { data: liabilities, mutate: mutateLiabs } = useApi<Liability[]>('/liabilities');
  const [modal, setModal] = useState<'asset' | 'liability' | null>(null);
  const [revaluing, setRevaluing] = useState<Asset | null>(null);
  const [paying, setPaying] = useState<Liability | null>(null);
  const [deleting, setDeleting] = useState<{ kind: 'assets' | 'liabilities'; id: string; name: string } | null>(null);
  const refresh = () => {
    mutateNw();
    mutateAssets();
    mutateLiabs();
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Assets & liabilities" description="Everything you own and owe, combined into your net worth." actions={<Button onClick={() => setModal(tab === 'assets' ? 'asset' : 'liability')}><Plus className="h-4 w-4" /> Add {tab === 'assets' ? 'asset' : 'liability'}</Button>} />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Net worth" value={<Money value={nw?.netWorth} />} hint={history ? `${Number(history.change) >= 0 ? '+' : ''}${Number(history.change).toLocaleString('en-IN')} over 12 months` : undefined} />
        <StatCard label="Total assets" value={<Money value={nw?.totalAssets} />} tone="positive" />
        <StatCard label="Total liabilities" value={<Money value={nw?.totalLiabilities} />} tone="negative" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Net worth trend" description="Monthly snapshots plus today" />
          <CardBody>{history?.points.length ? <TrendLine data={history.points} dataKey="netWorth" label="Net worth" /> : <EmptyState title="Trend appears after your first snapshot" />}</CardBody>
        </Card>
        <Card>
          <CardHeader title="Composition" />
          <CardBody className="space-y-2">
            {nw?.composition.map((c) => (
              <div key={c.key} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2"><span className={c.side === 'asset' ? 'h-2 w-2 rounded-full bg-positive' : 'h-2 w-2 rounded-full bg-negative'} />{c.label}</span>
                <Money value={c.side === 'asset' ? c.value : `-${c.value}`} tone={c.side === 'asset' ? 'none' : 'negative'} />
              </div>
            ))}
            <p className="pt-2 text-xs text-muted">{nw?.valuationNote}</p>
          </CardBody>
        </Card>
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'assets', label: 'Assets', count: assets?.length }, { value: 'liabilities', label: 'Other liabilities', count: liabilities?.length }]} />
      <Card>
        {tab === 'assets' ? (
          <DataTable
            rows={assets}
            loading={!assets}
            columns={[
              { key: 'name', header: 'Asset', render: (a) => <div><p className="font-medium">{a.name}</p><p className="text-xs text-muted">{titleCase(a.assetType)}{a.purchaseDate ? ` · bought ${formatDate(a.purchaseDate)}` : ''}</p></div> },
              { key: 'value', header: 'Current value', align: 'right', render: (a) => <div><Money value={a.currentValue} className="font-medium" /><p className="text-xs text-muted">{titleCase(a.valuationSource)} · {formatDate(a.valuationDate)}</p></div> },
              { key: 'gain', header: 'Gain', align: 'right', hideOnMobile: true, render: (a) => (a.gain ? <div><Money value={a.gain} tone="auto" sign /><p className="text-xs text-muted">{a.gainPercent}%</p></div> : '—') },
              { key: 'x', header: '', align: 'right', render: (a) => <div className="flex justify-end gap-1"><Button size="sm" variant="ghost" onClick={() => setRevaluing(a)}>Revalue</Button><Button size="sm" variant="ghost" onClick={() => setDeleting({ kind: 'assets', id: a.id, name: a.name })}>Delete</Button></div> },
            ]}
            empty={<EmptyState title="No assets recorded" description="Add property, vehicles, gold or other valuables." />}
          />
        ) : (
          <DataTable
            rows={liabilities}
            loading={!liabilities}
            columns={[
              { key: 'name', header: 'Liability', render: (l) => <div><p className="font-medium">{l.name}</p><p className="text-xs text-muted">{titleCase(l.liabilityType)}{l.counterparty ? ` · ${l.counterparty}` : ''}</p></div> },
              { key: 'due', header: 'Due', render: (l) => (l.dueDate ? <span className={l.overdue ? 'text-negative' : ''}>{formatDate(l.dueDate)}</span> : '—') },
              { key: 'amt', header: 'Outstanding', align: 'right', render: (l) => <Money value={l.amountOutstanding} className="font-medium" /> },
              { key: 'x', header: '', align: 'right', render: (l) => <div className="flex justify-end gap-1">{l.status === 'open' ? <Button size="sm" variant="ghost" onClick={() => setPaying(l)}>Record payment</Button> : <Badge tone="positive">Settled</Badge>}<Button size="sm" variant="ghost" onClick={() => setDeleting({ kind: 'liabilities', id: l.id, name: l.name })}>Delete</Button></div> },
            ]}
            empty={<EmptyState title="No other liabilities" description="Formal loans live under Loans & EMIs; add informal borrowings, dues or deposits here." />}
          />
        )}
      </Card>

      <FormModal
        open={modal === 'asset'}
        onClose={() => setModal(null)}
        title="Add asset"
        fields={[
          { name: 'name', label: 'Name', required: true, placeholder: '2BHK apartment, Pune' },
          { name: 'assetType', label: 'Type', type: 'select', required: true, options: enumOptions(ASSET_TYPES), half: true },
          { name: 'currentValue', label: 'Current value (₹)', type: 'money', required: true, half: true },
          { name: 'purchaseValue', label: 'Purchase price (₹)', type: 'money', half: true },
          { name: 'purchaseDate', label: 'Purchase date', type: 'date', half: true },
          { name: 'valuationSource', label: 'Valuation basis', type: 'select', half: true, options: enumOptions(['manual', 'appraisal', 'calculated']) },
          { name: 'notes', label: 'Notes', type: 'textarea' },
          { name: 'includeInNetWorth', label: 'Include in net worth', type: 'checkbox' },
        ]}
        initial={{ assetType: 'real_estate', valuationSource: 'manual', includeInNetWorth: true }}
        onSubmit={async (v) => {
          await api.post('/assets', cleanValues(v));
          toast('Asset added');
          refresh();
        }}
      />
      <FormModal
        open={modal === 'liability'}
        onClose={() => setModal(null)}
        title="Add liability"
        fields={[
          { name: 'name', label: 'Name', required: true, placeholder: 'Borrowed from Arjun' },
          { name: 'liabilityType', label: 'Type', type: 'select', required: true, options: enumOptions(LIAB_TYPES), half: true },
          { name: 'amountOutstanding', label: 'Amount owed (₹)', type: 'money', required: true, half: true },
          { name: 'counterparty', label: 'Owed to', half: true },
          { name: 'dueDate', label: 'Due date', type: 'date', half: true },
          { name: 'notes', label: 'Notes', type: 'textarea' },
        ]}
        initial={{ liabilityType: 'personal_borrowing' }}
        onSubmit={async (v) => {
          await api.post('/liabilities', cleanValues(v));
          toast('Liability added');
          refresh();
        }}
      />
      <FormModal
        open={!!revaluing}
        onClose={() => setRevaluing(null)}
        title={`Revalue ${revaluing?.name ?? ''}`}
        fields={[
          { name: 'currentValue', label: 'Current value (₹)', type: 'money', required: true, half: true },
          { name: 'valuationDate', label: 'As of', type: 'date', required: true, half: true },
          { name: 'valuationSource', label: 'Basis', type: 'select', required: true, options: enumOptions(['manual', 'appraisal', 'calculated']) },
        ]}
        initial={{ currentValue: revaluing?.currentValue ?? '', valuationDate: todayISO(), valuationSource: 'manual' }}
        onSubmit={async (v) => {
          await api.post(`/assets/${revaluing!.id}/revalue`, cleanValues(v));
          refresh();
        }}
      />
      <FormModal
        open={!!paying}
        onClose={() => setPaying(null)}
        title={`Repay ${paying?.name ?? ''}`}
        fields={[
          { name: 'amount', label: 'Amount (₹)', type: 'money', required: true, half: true },
          { name: 'paidOn', label: 'Date', type: 'date', required: true, half: true },
          { name: 'accountId', label: 'Paid from (records a ledger debit)', type: 'select', options: accounts },
        ]}
        initial={{ paidOn: todayISO() }}
        onSubmit={async (v) => {
          await api.post(`/liabilities/${paying!.id}/payments`, cleanValues(v));
          toast('Payment recorded');
          refresh();
        }}
      />
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} title="Delete record" message={`Delete ${deleting?.name}?`} danger confirmLabel="Delete" onConfirm={async () => { await api.delete(`/${deleting!.kind}/${deleting!.id}`); refresh(); }} />
    </div>
  );
}
