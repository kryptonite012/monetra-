'use client';
import { Calculator, Landmark, Plus } from 'lucide-react';
import { useState } from 'react';
import { cleanValues, ConfirmDialog, FormModal } from '@/components/form-modal';
import { Badge, Button, Card, CardBody, CardHeader, DataTable, EmptyState, Field, Input, Modal, Money, PageHeader, PageLoader, Progress, Select, StatCard, useToast } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { formatDate, formatMoney, titleCase, todayISO } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { enumOptions, useAccountOptions } from '@/lib/options';

interface Installment {
  id: string;
  installmentNo: number;
  dueDate: string;
  emiAmount: string;
  principalComponent: string;
  interestComponent: string;
  closingPrincipal: string;
  status: string;
  paidOn: string | null;
}

interface Loan {
  id: string;
  name: string;
  loanType: string;
  lender: string;
  principal: string;
  interestRate: string;
  tenureMonths: number;
  emiAmount: string;
  outstandingPrincipal: string;
  principalRepaid: string;
  interestPaid: string;
  interestRemaining: string;
  installmentsPaid: number;
  installmentsRemaining: number;
  overdueCount: number;
  progressPercent: string;
  status: string;
  repaymentAccountId: string | null;
  nextInstallment: { installmentNo: number; dueDate: string; emiAmount: string; overdue: boolean } | null;
  projectedClosureDate: string | null;
  schedule?: Installment[];
}

interface Summary {
  totalOutstanding: string;
  loans: { count: number; outstanding: string; monthlyEmi: string; interestRemaining: string };
  creditCards: { outstanding: string; totalLimit: string };
  otherLiabilities: string;
  upcomingEmis: Array<{ loanId: string; name: string; lender: string; installmentNo: number; dueDate: string; emiAmount: string; overdue: boolean }>;
}

const TYPES = ['home', 'vehicle', 'personal', 'education', 'gold', 'business', 'consumer_durable', 'credit_card_emi', 'other'] as const;

function EmiCalculator() {
  const [p, setP] = useState('1000000');
  const [r, setR] = useState('8.5');
  const [n, setN] = useState('240');
  const [quote, setQuote] = useState<{ emi: string; totalInterest: string; totalPayment: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader title="EMI calculator" description="Reducing-balance EMI with full amortisation" action={<Calculator className="h-4 w-4 text-muted" />} />
      <CardBody className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <Field label="Loan (₹)"><Input className="num" value={p} onChange={(e) => setP(e.target.value.replace(/[^\d.]/g, ''))} /></Field>
          <Field label="Rate %"><Input className="num" value={r} onChange={(e) => setR(e.target.value.replace(/[^\d.]/g, ''))} /></Field>
          <Field label="Months"><Input className="num" value={n} onChange={(e) => setN(e.target.value.replace(/\D/g, ''))} /></Field>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={async () => {
            setError(null);
            try {
              setQuote(await api.post('/loans/calculator', { principal: p, interestRate: r, tenureMonths: Number(n) }));
            } catch (err) {
              setError((err as ApiError).message);
            }
          }}
        >
          Calculate
        </Button>
        {error && <p className="text-xs text-negative">{error}</p>}
        {quote && (
          <div className="grid grid-cols-3 gap-2 text-sm">
            <div className="rounded-xl bg-brand-soft p-3"><p className="text-xs text-muted">Monthly EMI</p><Money value={quote.emi} className="font-semibold text-brand" /></div>
            <div className="rounded-xl bg-surface-2 p-3"><p className="text-xs text-muted">Total interest</p><Money value={quote.totalInterest} className="font-semibold" /></div>
            <div className="rounded-xl bg-surface-2 p-3"><p className="text-xs text-muted">Total payable</p><Money value={quote.totalPayment} className="font-semibold" /></div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

export default function LoansPage() {
  const toast = useToast();
  const accounts = useAccountOptions();
  const { data: loans, mutate, isLoading } = useApi<Loan[]>('/loans?includeClosed=true');
  const { data: summary, mutate: mutateSummary } = useApi<Summary>('/loans/summary');
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const { data: detail, mutate: mutateDetail } = useApi<Loan>(viewing ? `/loans/${viewing}` : null);
  const [payAccount, setPayAccount] = useState('');
  const [prepaying, setPrepaying] = useState(false);
  const [foreclosing, setForeclosing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const refresh = () => {
    mutate();
    mutateSummary();
    mutateDetail();
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Loans & EMIs" description="Home, vehicle, personal and education loans with EMI schedules, prepayment planning and your total liabilities." actions={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Add loan</Button>} />
      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard label="Total outstanding" value={<Money value={summary?.totalOutstanding} />} tone="negative" hint="Loans, cards and other dues" icon={<Landmark className="h-4 w-4" />} />
        <StatCard label="Monthly EMIs" value={<Money value={summary?.loans.monthlyEmi} />} hint={`${summary?.loans.count ?? 0} active loans`} tone="warning" />
        <StatCard label="Interest still to pay" value={<Money value={summary?.loans.interestRemaining} />} />
        <StatCard label="Credit card dues" value={<Money value={summary?.creditCards.outstanding} />} tone="accent" hint={summary && Number(summary.otherLiabilities) > 0 ? `+ ${formatMoney(summary.otherLiabilities)} other liabilities` : undefined} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {isLoading ? (
            <PageLoader />
          ) : loans?.length ? (
            loans.map((l) => (
              <Card key={l.id} className="animate-in cursor-pointer p-5 transition hover:border-brand/40" onClick={() => setViewing(l.id)}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{l.name}</p>
                    <p className="text-xs text-muted">{l.lender} · {titleCase(l.loanType)} · {Number(l.interestRate)}% · {l.tenureMonths} months</p>
                  </div>
                  {l.status !== 'active' ? <Badge>{titleCase(l.status)}</Badge> : l.overdueCount ? <Badge tone="negative">{l.overdueCount} overdue</Badge> : <Badge tone="brand">EMI <Money value={l.emiAmount} /></Badge>}
                </div>
                <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                  <div><p className="text-xs text-muted">Outstanding</p><Money value={l.outstandingPrincipal} className="font-semibold" /></div>
                  <div><p className="text-xs text-muted">Repaid</p><Money value={l.principalRepaid} /></div>
                  <div><p className="text-xs text-muted">Interest left</p><Money value={l.interestRemaining} /></div>
                </div>
                <Progress value={Number(l.progressPercent)} className="mt-3" />
                <p className="mt-1.5 text-xs text-muted">{l.installmentsPaid} paid · {l.installmentsRemaining} remaining{l.nextInstallment ? ` · next ${formatDate(l.nextInstallment.dueDate)}` : ''}{l.projectedClosureDate ? ` · closes ${formatDate(l.projectedClosureDate)}` : ''}</p>
              </Card>
            ))
          ) : (
            <EmptyState title="No loans recorded" description="Add your loans to see EMI schedules and your debt-free date." action={<Button onClick={() => setCreating(true)}>Add loan</Button>} />
          )}
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Upcoming EMIs" />
            <CardBody className="space-y-2">
              {summary?.upcomingEmis.map((e) => (
                <div key={`${e.loanId}-${e.installmentNo}`} className="flex items-center justify-between rounded-xl border border-border px-3 py-2 text-sm">
                  <div><p className="font-medium">{e.name}</p><p className={e.overdue ? 'text-xs text-negative' : 'text-xs text-muted'}>#{e.installmentNo} · {formatDate(e.dueDate)}</p></div>
                  <Money value={e.emiAmount} />
                </div>
              ))}
              {!summary?.upcomingEmis.length && <p className="text-sm text-muted">No EMIs due.</p>}
            </CardBody>
          </Card>
          <EmiCalculator />
        </div>
      </div>

      <FormModal
        open={creating}
        onClose={() => setCreating(false)}
        title="Add a loan"
        description="The EMI and amortisation schedule are calculated for you. For an older loan, enter how many EMIs you have already paid."
        size="lg"
        fields={[
          { name: 'name', label: 'Loan name', required: true, placeholder: 'Home loan' },
          { name: 'loanType', label: 'Type', type: 'select', required: true, options: enumOptions(TYPES), half: true },
          { name: 'lender', label: 'Lender', required: true, half: true },
          { name: 'principal', label: 'Loan amount (₹)', type: 'money', required: true, half: true },
          { name: 'interestRate', label: 'Interest rate (% p.a.)', type: 'number', required: true, half: true },
          { name: 'tenureMonths', label: 'Tenure (months)', type: 'number', required: true, half: true },
          { name: 'interestType', label: 'Interest type', type: 'select', required: true, half: true, options: [{ value: 'reducing', label: 'Reducing balance' }, { value: 'flat', label: 'Flat rate' }] },
          { name: 'startDate', label: 'Disbursement date', type: 'date', required: true, half: true },
          { name: 'firstEmiDate', label: 'First EMI date', type: 'date', half: true },
          { name: 'emiAmount', label: 'EMI (₹) if different from calculated', type: 'money', half: true },
          { name: 'processingFee', label: 'Processing fee (₹)', type: 'money', half: true },
          { name: 'paidInstallments', label: 'EMIs already paid', type: 'number', half: true },
          { name: 'repaymentAccountId', label: 'EMIs paid from', type: 'select', options: accounts, half: true },
          { name: 'disbursementAccountId', label: 'Record disbursement into', type: 'select', options: accounts, hint: 'Only for a new loan whose money you received now.' },
        ]}
        initial={{ loanType: 'home', interestType: 'reducing', startDate: todayISO() }}
        onSubmit={async (v) => {
          const body = cleanValues(v);
          for (const k of ['tenureMonths', 'paidInstallments']) if (body[k] !== undefined) body[k] = Number(body[k]);
          await api.post('/loans', body);
          toast('Loan added with its EMI schedule');
          refresh();
        }}
      />

      <Modal open={!!viewing} onClose={() => setViewing(null)} title={detail?.name ?? ''} description={detail ? `${detail.lender} · ${Number(detail.interestRate)}% · EMI ${formatMoney(detail.emiAmount)}` : undefined} size="xl">
        {detail && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="rounded-xl bg-surface-2 p-3"><p className="text-xs text-muted">Outstanding</p><Money value={detail.outstandingPrincipal} className="font-semibold" /></div>
              <div className="rounded-xl bg-surface-2 p-3"><p className="text-xs text-muted">Interest paid</p><Money value={detail.interestPaid} className="font-semibold" /></div>
              <div className="rounded-xl bg-surface-2 p-3"><p className="text-xs text-muted">Interest remaining</p><Money value={detail.interestRemaining} className="font-semibold" /></div>
              <div className="rounded-xl bg-surface-2 p-3"><p className="text-xs text-muted">Closes</p><span className="font-semibold">{formatDate(detail.projectedClosureDate)}</span></div>
            </div>
            {detail.status === 'active' && detail.nextInstallment && (
              <div className="flex flex-wrap items-end gap-2 rounded-xl border border-brand/40 bg-brand-soft/40 p-3">
                <div className="flex-1 text-sm">
                  <p className="font-medium">Next: EMI #{detail.nextInstallment.installmentNo} · <Money value={detail.nextInstallment.emiAmount} /></p>
                  <p className="text-xs text-muted">Due {formatDate(detail.nextInstallment.dueDate)}</p>
                </div>
                <Select value={payAccount || detail.repaymentAccountId || ''} onChange={(e) => setPayAccount(e.target.value)} className="h-9 w-48" aria-label="Paid from">
                  <option value="">Paid from…</option>
                  {accounts.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                </Select>
                <Button
                  size="sm"
                  onClick={async () => {
                    try {
                      await api.post(`/loans/${detail.id}/installments/${detail.nextInstallment!.installmentNo}/pay`, { accountId: payAccount || detail.repaymentAccountId, paidOn: todayISO() });
                      toast('EMI recorded');
                      refresh();
                    } catch (err) {
                      toast((err as ApiError).message, 'error');
                    }
                  }}
                >
                  Mark paid
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setPrepaying(true)}>Prepay</Button>
                <Button size="sm" variant="ghost" onClick={() => setForeclosing(true)}>Foreclose</Button>
              </div>
            )}
            <div className="max-h-80 overflow-y-auto rounded-xl border border-border">
              <DataTable
                rows={detail.schedule}
                columns={[
                  { key: 'no', header: '#', render: (i) => i.installmentNo },
                  { key: 'due', header: 'Due', render: (i) => formatDate(i.dueDate) },
                  { key: 'emi', header: 'Payment', align: 'right', render: (i) => <Money value={i.emiAmount} /> },
                  { key: 'p', header: 'Principal', align: 'right', hideOnMobile: true, render: (i) => <Money value={i.principalComponent} /> },
                  { key: 'i', header: 'Interest', align: 'right', hideOnMobile: true, render: (i) => <Money value={i.interestComponent} /> },
                  { key: 'bal', header: 'Balance', align: 'right', render: (i) => <Money value={i.closingPrincipal} /> },
                  { key: 's', header: 'Status', render: (i) => <Badge tone={i.status === 'paid' ? 'positive' : i.status === 'prepayment' ? 'accent' : i.status === 'cancelled' ? 'neutral' : i.dueDate < todayISO() ? 'negative' : 'neutral'}>{i.status === 'due' && i.dueDate < todayISO() ? 'overdue' : i.status}</Badge> },
                ]}
              />
            </div>
            <div className="flex justify-end"><Button size="sm" variant="ghost" onClick={() => setDeleting(true)}>Delete loan</Button></div>
          </div>
        )}
      </Modal>
      {detail && (
        <>
          <FormModal
            open={prepaying}
            onClose={() => setPrepaying(false)}
            title="Part-prepayment"
            description="Paying extra principal reduces your interest. Choose whether to shorten the tenure or lower the EMI."
            fields={[
              { name: 'amount', label: 'Prepayment (₹)', type: 'money', required: true, half: true },
              { name: 'paidOn', label: 'Date', type: 'date', required: true, half: true },
              { name: 'accountId', label: 'Paid from', type: 'select', required: true, options: accounts, half: true },
              { name: 'strategy', label: 'Then', type: 'select', required: true, half: true, options: [{ value: 'reduce_tenure', label: 'Keep EMI, finish sooner' }, { value: 'reduce_emi', label: 'Keep tenure, lower EMI' }] },
            ]}
            initial={{ paidOn: todayISO(), strategy: 'reduce_tenure', accountId: detail.repaymentAccountId ?? '' }}
            onSubmit={async (v) => {
              const r = await api.post<{ impact: { interestSaved: string; newTenureMonths: number; newEmi: string } }>(`/loans/${detail.id}/prepay`, cleanValues(v));
              toast(`Interest saved: ${formatMoney(r.impact.interestSaved)} · ${r.impact.newTenureMonths} EMIs left of ${formatMoney(r.impact.newEmi)}`);
              refresh();
            }}
          />
          <FormModal
            open={foreclosing}
            onClose={() => setForeclosing(false)}
            title="Foreclose loan"
            description={`Outstanding principal is ${formatMoney(detail.outstandingPrincipal)}. Include any foreclosure charges in the amount.`}
            fields={[
              { name: 'amount', label: 'Final payment (₹)', type: 'money', required: true, half: true },
              { name: 'paidOn', label: 'Date', type: 'date', required: true, half: true },
              { name: 'accountId', label: 'Paid from', type: 'select', required: true, options: accounts },
            ]}
            initial={{ amount: detail.outstandingPrincipal, paidOn: todayISO(), accountId: detail.repaymentAccountId ?? '' }}
            onSubmit={async (v) => {
              await api.post(`/loans/${detail.id}/foreclose`, cleanValues(v));
              toast('Loan closed. Congratulations!');
              refresh();
            }}
          />
          <ConfirmDialog open={deleting} onClose={() => setDeleting(false)} title="Delete loan" message="Only loans without recorded payments can be deleted." danger confirmLabel="Delete" onConfirm={async () => { await api.delete(`/loans/${detail.id}`); setViewing(null); refresh(); }} />
        </>
      )}
    </div>
  );
}
