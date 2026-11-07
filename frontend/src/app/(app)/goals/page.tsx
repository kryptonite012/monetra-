'use client';
import { CalendarClock, Plus, Target } from 'lucide-react';
import { useState } from 'react';
import { cleanValues, ConfirmDialog, FormModal } from '@/components/form-modal';
import { Badge, Button, Card, EmptyState, Modal, Money, PageHeader, PageLoader, Progress, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate, formatMoney, titleCase, todayISO } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { enumOptions, useAccountOptions } from '@/lib/options';

interface Goal {
  id: string;
  name: string;
  goalType: string;
  targetAmount: string;
  targetDate: string | null;
  monthlyContribution: string | null;
  savedAmount: string;
  remainingAmount: string;
  completionPercent: string;
  estimatedCompletionDate: string | null;
  requiredMonthlyContribution: string | null;
  onTrack: boolean | null;
  status: string;
  priority: number;
  estimateNote: string;
  expectedReturnRate: string;
}

const TYPES = ['emergency', 'education', 'vehicle', 'house', 'vacation', 'retirement', 'wedding', 'gadget', 'custom'] as const;
const EMOJI: Record<string, string> = { emergency: '🛟', education: '🎓', vehicle: '🚗', house: '🏠', vacation: '🏖️', retirement: '🌅', wedding: '💍', gadget: '💻', custom: '🎯' };

export default function GoalsPage() {
  const toast = useToast();
  const accounts = useAccountOptions();
  const { data: goals, mutate, isLoading } = useApi<Goal[]>('/goals');
  const [creating, setCreating] = useState(false);
  const [contributing, setContributing] = useState<Goal | null>(null);
  const [viewing, setViewing] = useState<Goal | null>(null);
  const [deleting, setDeleting] = useState<Goal | null>(null);
  const { data: detail, mutate: mutateDetail } = useApi<Goal & { contributions: Array<{ id: string; amount: string; contributedOn: string; note: string | null }> }>(viewing ? `/goals/${viewing.id}` : null);

  const active = goals?.filter((g) => g.status === 'active' || g.status === 'paused') ?? [];
  const done = goals?.filter((g) => g.status === 'achieved') ?? [];

  const card = (g: Goal) => (
    <Card key={g.id} className="animate-in flex flex-col p-5">
      <div className="flex items-start justify-between gap-2">
        <button className="text-left" onClick={() => setViewing(g)}>
          <p className="text-lg">{EMOJI[g.goalType]} <span className="text-base font-semibold">{g.name}</span></p>
          <p className="text-xs text-muted">{titleCase(g.goalType)}{g.targetDate ? ` · by ${formatDate(g.targetDate)}` : ''}</p>
        </button>
        {g.status === 'achieved' ? <Badge tone="positive">Achieved</Badge> : g.onTrack === true ? <Badge tone="positive">On track</Badge> : g.onTrack === false ? <Badge tone="warning">Behind</Badge> : <Badge>No deadline</Badge>}
      </div>
      <div className="mt-4 flex items-end justify-between">
        <Money value={g.savedAmount} className="text-2xl font-semibold" />
        <span className="text-sm text-muted">of {formatMoney(g.targetAmount)}</span>
      </div>
      <Progress value={Number(g.completionPercent)} tone={g.status === 'achieved' ? 'positive' : 'brand'} className="mt-2" />
      <div className="mt-3 space-y-1 text-xs text-muted">
        <p className="flex items-center gap-1.5"><CalendarClock className="h-3.5 w-3.5" />{g.estimatedCompletionDate ? `Estimated completion ${formatDate(g.estimatedCompletionDate)}` : 'Add a monthly plan to estimate completion'}</p>
        {g.requiredMonthlyContribution && g.status === 'active' && <p>Save {formatMoney(g.requiredMonthlyContribution)}/month to finish by the target date</p>}
      </div>
      <div className="mt-auto flex gap-2 pt-4">
        <Button size="sm" onClick={() => setContributing(g)} disabled={g.status === 'cancelled'}>Add money</Button>
        <Button size="sm" variant="ghost" onClick={() => setViewing(g)}>History</Button>
      </div>
    </Card>
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Savings goals" description="Emergency fund, education, a car, a home or a holiday. Track progress and see realistic completion dates." actions={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New goal</Button>} />
      {isLoading ? (
        <PageLoader />
      ) : !goals?.length ? (
        <EmptyState icon={<Target className="h-5 w-5" />} title="No goals yet" description="Start with an emergency fund covering 6 months of expenses." action={<Button onClick={() => setCreating(true)}>Create a goal</Button>} />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{active.map(card)}</div>
          {done.length > 0 && (
            <>
              <h2 className="text-sm font-semibold text-muted">Achieved 🎉</h2>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{done.map(card)}</div>
            </>
          )}
        </>
      )}
      <FormModal
        open={creating}
        onClose={() => setCreating(false)}
        title="New savings goal"
        fields={[
          { name: 'name', label: 'Goal name', required: true, placeholder: 'Emergency fund' },
          { name: 'goalType', label: 'Type', type: 'select', required: true, options: enumOptions(TYPES), half: true },
          { name: 'targetAmount', label: 'Target amount (₹)', type: 'money', required: true, half: true },
          { name: 'targetDate', label: 'Target date', type: 'date', half: true },
          { name: 'monthlyContribution', label: 'Planned monthly saving (₹)', type: 'money', half: true },
          { name: 'initialAmount', label: 'Already saved (₹)', type: 'money', half: true },
          { name: 'expectedReturnRate', label: 'Expected return (% p.a.)', type: 'number', half: true, hint: 'e.g. 7 for an FD/RD. Leave blank for none.' },
          { name: 'linkedAccountId', label: 'Saving into account', type: 'select', options: accounts },
        ]}
        initial={{ goalType: 'emergency' }}
        onSubmit={async (v) => {
          await api.post('/goals', cleanValues(v));
          toast('Goal created');
          mutate();
        }}
      />
      <FormModal
        open={!!contributing}
        onClose={() => setContributing(null)}
        title={`Add money to ${contributing?.name ?? ''}`}
        description="Use a negative amount to withdraw. Optionally move the money between two of your accounts."
        fields={[
          { name: 'amount', label: 'Amount (₹)', type: 'money', required: true, half: true },
          { name: 'contributedOn', label: 'Date', type: 'date', required: true, half: true },
          { name: 'fromAccountId', label: 'From account', type: 'select', options: accounts, half: true },
          { name: 'toAccountId', label: 'To account', type: 'select', options: accounts, half: true },
          { name: 'note', label: 'Note' },
        ]}
        initial={{ contributedOn: todayISO() }}
        onSubmit={async (v) => {
          const g = await api.post<Goal>(`/goals/${contributing!.id}/contributions`, cleanValues(v));
          toast(g.status === 'achieved' ? `🎉 ${g.name} achieved!` : `${g.name} is now ${Number(g.completionPercent).toFixed(0)}% funded`);
          mutate();
        }}
      />
      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing?.name ?? ''} description={detail?.estimateNote} size="lg">
        {detail && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div className="rounded-xl bg-surface-2 p-3"><p className="text-xs text-muted">Saved</p><Money value={detail.savedAmount} className="font-semibold" /></div>
              <div className="rounded-xl bg-surface-2 p-3"><p className="text-xs text-muted">Remaining</p><Money value={detail.remainingAmount} className="font-semibold" /></div>
              <div className="rounded-xl bg-surface-2 p-3"><p className="text-xs text-muted">Progress</p><span className="num font-semibold">{Number(detail.completionPercent).toFixed(1)}%</span></div>
            </div>
            <ul className="divide-y divide-border/70">
              {detail.contributions.map((c) => (
                <li key={c.id} className="flex justify-between py-2 text-sm">
                  <span>{formatDate(c.contributedOn)} <span className="text-xs text-muted">{c.note ?? ''}</span></span>
                  <Money value={c.amount} tone="auto" sign />
                </li>
              ))}
              {!detail.contributions.length && <li className="py-2 text-sm text-muted">No contributions yet.</li>}
            </ul>
            <div className="flex justify-between border-t border-border pt-3">
              <div className="flex gap-2">
                {detail.status === 'active' && <Button size="sm" variant="secondary" onClick={async () => { await api.patch(`/goals/${detail.id}`, { status: 'paused' }); mutate(); mutateDetail(); }}>Pause</Button>}
                {detail.status === 'paused' && <Button size="sm" variant="secondary" onClick={async () => { await api.patch(`/goals/${detail.id}`, { status: 'active' }); mutate(); mutateDetail(); }}>Resume</Button>}
              </div>
              <Button size="sm" variant="ghost" onClick={() => { setDeleting(detail); setViewing(null); }}>Delete goal</Button>
            </div>
          </div>
        )}
      </Modal>
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} title="Delete goal" message="Contribution records are removed; money moved between accounts stays in your ledger." danger confirmLabel="Delete" onConfirm={async () => { await api.delete(`/goals/${deleting!.id}`); mutate(); }} />
    </div>
  );
}
