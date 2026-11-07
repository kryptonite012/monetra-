'use client';
import { Info, Plus, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { DonutChart, Legend } from '@/components/charts';
import { cleanValues, ConfirmDialog, FormModal } from '@/components/form-modal';
import { Badge, Button, Card, CardBody, CardHeader, DataTable, EmptyState, Modal, Money, PageHeader, StatCard, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate, formatPercent, titleCase, todayISO } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { enumOptions, useAccountOptions } from '@/lib/options';

interface Holding {
  id: string;
  name: string;
  instrumentType: string;
  symbol: string | null;
  schemeCode: string | null;
  units: string;
  investedAmount: string;
  currentValue: string;
  unrealizedGain: string;
  unrealizedGainPercent: string | null;
  realizedGain: string;
  averageCost: string | null;
  currentPrice: string | null;
  valuationSource: string;
  valuationLabel: string;
  priceAsOf: string | null;
  priceStale: boolean;
  status: string;
}

interface Portfolio {
  totals: { holdings: number; invested: string; currentValue: string; unrealizedGain: string; unrealizedGainPercent: string | null; realizedGain: string; xirrPercent: string | null };
  allocation: Array<{ instrumentType: string; value: string; percent: string }>;
  dataSources: Array<{ source: string; label: string; count: number }>;
  disclaimer: string;
}

const TYPES = ['stock', 'mutual_fund', 'etf', 'fixed_deposit', 'recurring_deposit', 'gold', 'sovereign_gold_bond', 'bond', 'ppf', 'epf', 'nps', 'crypto', 'real_estate_fund', 'other'] as const;
const DEPOSITS = ['fixed_deposit', 'recurring_deposit', 'ppf', 'epf', 'nps'];
const sourceTone = (s: string) => (s === 'live' ? 'positive' : s === 'delayed' ? 'accent' : s === 'calculated' ? 'brand' : s === 'simulated' ? 'warning' : 'neutral') as 'positive' | 'accent' | 'brand' | 'warning' | 'neutral';

export default function InvestmentsPage() {
  const toast = useToast();
  const accounts = useAccountOptions();
  const { data: holdings, mutate } = useApi<Holding[]>('/investments');
  const { data: portfolio, mutate: mutatePortfolio } = useApi<Portfolio>('/investments/portfolio');
  const { data: provider } = useApi<{ configured: boolean; note: string }>('/investments/market-data');
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const { data: detail, mutate: mutateDetail } = useApi<Holding & { xirrPercent: string | null; incomeReceived: string; transactions: Array<{ id: string; type: string; tradeDate: string; units: string; price: string; amount: string; fees: string; realizedGain: string | null }> }>(viewing ? `/investments/${viewing}` : null);
  const [txnOpen, setTxnOpen] = useState(false);
  const [priceOpen, setPriceOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = () => {
    mutate();
    mutatePortfolio();
    mutateDetail();
  };
  const gain = Number(portfolio?.totals.unrealizedGain ?? 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Investments"
        description="Stocks, mutual funds, ETFs, FDs, gold, bonds and more, each labelled with where its price comes from."
        actions={
          <>
            <Button
              variant="secondary"
              loading={refreshing}
              onClick={async () => {
                setRefreshing(true);
                const r = await api.post<{ message: string }>('/investments/refresh-prices').finally(() => setRefreshing(false));
                toast(r.message, 'info');
                refresh();
              }}
            >
              <RefreshCw className="h-4 w-4" /> Refresh prices
            </Button>
            <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Add holding</Button>
          </>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Current value" value={<Money value={portfolio?.totals.currentValue} />} hint={`${portfolio?.totals.holdings ?? 0} holdings`} />
        <StatCard label="Invested" value={<Money value={portfolio?.totals.invested} />} tone="accent" />
        <StatCard label="Unrealised gain" value={<Money value={portfolio?.totals.unrealizedGain} tone="auto" sign />} hint={formatPercent(portfolio?.totals.unrealizedGainPercent)} tone={gain >= 0 ? 'positive' : 'negative'} />
        <StatCard label="Realised gain & income" value={<Money value={portfolio?.totals.realizedGain} tone="auto" />} tone="positive" />
        <StatCard label="XIRR" value={<span className="num">{formatPercent(portfolio?.totals.xirrPercent)}</span>} hint="Annualised, money-weighted" tone="warning" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Holdings" />
          <DataTable
            rows={holdings}
            loading={!holdings}
            onRowClick={(h) => setViewing(h.id)}
            columns={[
              { key: 'name', header: 'Holding', render: (h) => <div><p className="font-medium">{h.name}</p><p className="text-xs text-muted">{titleCase(h.instrumentType)}{h.symbol ? ` · ${h.symbol}` : ''}{Number(h.units) ? ` · ${Number(h.units).toLocaleString('en-IN', { maximumFractionDigits: 4 })} units` : ''}</p></div> },
              { key: 'value', header: 'Value', align: 'right', render: (h) => <div><Money value={h.currentValue} className="font-medium" /><p className="text-xs text-muted">cost <Money value={h.investedAmount} /></p></div> },
              { key: 'gain', header: 'Gain', align: 'right', render: (h) => <div><Money value={h.unrealizedGain} tone="auto" sign /><p className="text-xs text-muted">{formatPercent(h.unrealizedGainPercent)}</p></div> },
              { key: 'src', header: 'Price source', hideOnMobile: true, render: (h) => <div><Badge tone={sourceTone(h.valuationSource)}>{h.valuationLabel}</Badge>{h.priceStale && <p className="mt-0.5 text-[11px] text-warning">Price may be outdated</p>}</div> },
            ]}
            empty={<EmptyState title="No investments yet" action={<Button onClick={() => setCreating(true)}>Add holding</Button>} />}
          />
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Asset allocation" />
            <CardBody>
              {portfolio?.allocation.length ? (
                <>
                  <DonutChart data={portfolio.allocation.map((a) => ({ name: titleCase(a.instrumentType), value: Number(a.value) }))} height={170} />
                  <Legend items={portfolio.allocation.map((a) => ({ name: titleCase(a.instrumentType), value: a.value, extra: `${a.percent}%` }))} />
                </>
              ) : (
                <p className="text-sm text-muted">No holdings yet.</p>
              )}
            </CardBody>
          </Card>
          <Card className="p-4 text-xs text-muted">
            <p className="mb-2 flex items-center gap-1.5 font-medium text-text"><Info className="h-4 w-4" /> Data sources</p>
            <ul className="mb-2 space-y-1">
              {portfolio?.dataSources.map((d) => <li key={d.source}>{d.label}: {d.count}</li>)}
            </ul>
            <p>{provider?.note}</p>
            <p className="mt-2">{portfolio?.disclaimer}</p>
          </Card>
        </div>
      </div>

      <FormModal
        open={creating}
        onClose={() => setCreating(false)}
        title="Add holding"
        size="lg"
        fields={[
          { name: 'instrumentType', label: 'Type', type: 'select', required: true, options: enumOptions(TYPES), half: true },
          { name: 'name', label: 'Name', required: true, half: true, placeholder: 'Infosys Ltd / Parag Parikh Flexi Cap' },
          { name: 'symbol', label: 'Symbol', half: true, show: (v) => ['stock', 'etf', 'crypto'].includes(String(v.instrumentType)) },
          { name: 'exchange', label: 'Exchange', type: 'select', half: true, options: [{ value: 'NSE', label: 'NSE' }, { value: 'BSE', label: 'BSE' }, { value: 'OTHER', label: 'Other' }], show: (v) => ['stock', 'etf'].includes(String(v.instrumentType)) },
          { name: 'schemeCode', label: 'AMFI scheme code', half: true, show: (v) => v.instrumentType === 'mutual_fund', hint: 'Enables official end-of-day NAV refresh.' },
          { name: 'isin', label: 'ISIN', half: true, show: (v) => !DEPOSITS.includes(String(v.instrumentType)) },
          { name: 'interestRate', label: 'Interest rate (% p.a.)', type: 'number', half: true, show: (v) => DEPOSITS.includes(String(v.instrumentType)) || v.instrumentType === 'bond' },
          { name: 'maturityDate', label: 'Maturity date', type: 'date', half: true, show: (v) => DEPOSITS.includes(String(v.instrumentType)) || v.instrumentType === 'bond' },
          { name: 'riskLevel', label: 'Risk level', type: 'select', half: true, options: enumOptions(['low', 'moderate', 'high', 'very_high']) },
          { name: 'units', label: 'Units bought', type: 'number', half: true, show: (v) => !DEPOSITS.includes(String(v.instrumentType)) },
          { name: 'price', label: 'Price per unit (₹)', type: 'money', half: true, show: (v) => !DEPOSITS.includes(String(v.instrumentType)) },
          { name: 'amount', label: 'Amount invested (₹)', type: 'money', half: true, show: (v) => DEPOSITS.includes(String(v.instrumentType)) },
          { name: 'tradeDate', label: 'Purchase / start date', type: 'date', required: true, half: true },
          { name: 'fees', label: 'Charges (₹)', type: 'money', half: true },
          { name: 'cashAccountId', label: 'Paid from account', type: 'select', options: accounts, half: true, hint: 'Leave empty for holdings bought earlier.' },
        ]}
        initial={{ instrumentType: 'mutual_fund', tradeDate: todayISO() }}
        onSubmit={async (v) => {
          const { units, price, amount, tradeDate, fees, cashAccountId, ...meta } = cleanValues(v) as Record<string, string>;
          await api.post('/investments', { ...meta, startDate: DEPOSITS.includes(meta.instrumentType) ? tradeDate : undefined, initial: { units, price, amount, tradeDate, fees, cashAccountId } });
          toast('Holding added');
          refresh();
        }}
      />

      <Modal open={!!viewing} onClose={() => setViewing(null)} title={detail?.name ?? ''} description={detail ? `${titleCase(detail.instrumentType)} · ${detail.valuationLabel}${detail.priceAsOf ? ` as of ${formatDate(detail.priceAsOf)}` : ''}` : undefined} size="lg">
        {detail && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="rounded-xl bg-surface-2 p-3"><p className="text-xs text-muted">Value</p><Money value={detail.currentValue} className="font-semibold" /></div>
              <div className="rounded-xl bg-surface-2 p-3"><p className="text-xs text-muted">Gain</p><Money value={detail.unrealizedGain} tone="auto" sign className="font-semibold" /></div>
              <div className="rounded-xl bg-surface-2 p-3"><p className="text-xs text-muted">Avg cost</p><span className="num font-semibold">{detail.averageCost ? Number(detail.averageCost).toFixed(2) : '—'}</span></div>
              <div className="rounded-xl bg-surface-2 p-3"><p className="text-xs text-muted">XIRR</p><span className="num font-semibold">{formatPercent(detail.xirrPercent)}</span></div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setTxnOpen(true)}>Record transaction</Button>
              {!DEPOSITS.includes(detail.instrumentType) && <Button size="sm" variant="secondary" onClick={() => setPriceOpen(true)}>Update price</Button>}
              <Button size="sm" variant="ghost" onClick={() => setDeleting(true)}>Delete</Button>
            </div>
            <DataTable
              rows={detail.transactions}
              columns={[
                { key: 'd', header: 'Date', render: (t) => formatDate(t.tradeDate) },
                { key: 't', header: 'Type', render: (t) => <Badge tone={t.type === 'buy' ? 'accent' : t.type === 'sell' ? 'warning' : 'positive'}>{t.type}</Badge> },
                { key: 'u', header: 'Units', align: 'right', render: (t) => (Number(t.units) ? Number(t.units).toLocaleString('en-IN', { maximumFractionDigits: 4 }) : '—') },
                { key: 'p', header: 'Price', align: 'right', hideOnMobile: true, render: (t) => (Number(t.price) ? Number(t.price).toFixed(2) : '—') },
                { key: 'a', header: 'Amount', align: 'right', render: (t) => <Money value={t.amount} /> },
                { key: 'g', header: 'Realised', align: 'right', hideOnMobile: true, render: (t) => (t.realizedGain ? <Money value={t.realizedGain} tone="auto" /> : '') },
              ]}
            />
          </div>
        )}
      </Modal>
      {detail && (
        <>
          <FormModal
            open={txnOpen}
            onClose={() => setTxnOpen(false)}
            title="Record transaction"
            description="Sells use the average-cost method to calculate realised gains."
            fields={[
              { name: 'type', label: 'Type', type: 'select', required: true, half: true, options: enumOptions(['buy', 'sell', 'dividend', 'interest', 'bonus', 'split', 'fee']) },
              { name: 'tradeDate', label: 'Date', type: 'date', required: true, half: true },
              { name: 'units', label: 'Units', type: 'number', half: true, show: (v) => ['buy', 'sell', 'bonus', 'split'].includes(String(v.type)) },
              { name: 'price', label: 'Price per unit (₹)', type: 'money', half: true, show: (v) => ['buy', 'sell'].includes(String(v.type)) },
              { name: 'amount', label: 'Amount (₹)', type: 'money', half: true, show: (v) => ['dividend', 'interest', 'fee'].includes(String(v.type)) || DEPOSITS.includes(detail.instrumentType) },
              { name: 'fees', label: 'Charges (₹)', type: 'money', half: true },
              { name: 'cashAccountId', label: 'Cash account', type: 'select', options: accounts, hint: 'Posts the cash movement to your ledger.' },
            ]}
            initial={{ type: 'buy', tradeDate: todayISO() }}
            onSubmit={async (v) => {
              await api.post(`/investments/${detail.id}/transactions`, cleanValues(v));
              toast('Transaction recorded');
              refresh();
            }}
          />
          <FormModal
            open={priceOpen}
            onClose={() => setPriceOpen(false)}
            title="Update price"
            description="Manually entered prices are labelled as such everywhere in Monetra."
            fields={[
              { name: 'price', label: 'Price per unit (₹)', type: 'money', required: true, half: true },
              { name: 'asOf', label: 'As of', type: 'date', required: true, half: true },
            ]}
            initial={{ asOf: todayISO(), price: detail.currentPrice ?? '' }}
            onSubmit={async (v) => {
              await api.post(`/investments/${detail.id}/price`, cleanValues(v));
              refresh();
            }}
          />
          <ConfirmDialog open={deleting} onClose={() => setDeleting(false)} title="Delete holding" message="Holdings with ledger-linked transactions cannot be deleted; sell them instead." danger confirmLabel="Delete" onConfirm={async () => { await api.delete(`/investments/${detail.id}`); setViewing(null); refresh(); }} />
        </>
      )}
    </div>
  );
}
