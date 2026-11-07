'use client';
import { Plus, Repeat } from 'lucide-react';
import { useState } from 'react';
import { cleanValues, ConfirmDialog, FormModal, type FieldDef } from '@/components/form-modal';
import { Badge, Button, Card, CardHeader, DataTable, EmptyState, Money, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate, titleCase, todayISO } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { enumOptions, useAccountOptions, useCategoryOptions } from '@/lib/options';

interface Rule {
  id: string;
  name: string;
  kind: 'income' | 'expense';
  amount: string;
  frequency: string;
  intervalCount: number;
  nextRunOn: string;
  isActive: boolean;
  autoPost: boolean;
  accountName: string;
  categoryName: string | null;
}

/** Recurring schedules for one kind (income or expense). */
export function RecurringPanel({ kind, onPosted }: { kind: 'income' | 'expense'; onPosted?: () => void }) {
  const toast = useToast();
  const { data, mutate } = useApi<Rule[]>(`/recurring-rules?kind=${kind}`);
  const accounts = useAccountOptions();
  const categories = useCategoryOptions(kind);
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<Rule | null>(null);

  const fields: FieldDef[] = [
    { name: 'name', label: 'Name', required: true, placeholder: kind === 'income' ? 'Monthly salary' : 'House rent' },
    { name: 'amount', label: 'Amount (₹)', type: 'money', required: true, half: true },
    { name: 'accountId', label: 'Account', type: 'select', options: accounts, required: true, half: true },
    ...(kind === 'income' ? [{ name: 'incomeSource', label: 'Source', type: 'select' as const, required: true, half: true, options: enumOptions(['salary', 'business', 'freelance', 'rental', 'interest', 'dividend', 'pension', 'other']) }] : [{ name: 'merchantName', label: 'Payee / merchant', half: true }]),
    { name: 'categoryId', label: 'Category', type: 'select', options: categories, half: true },
    { name: 'description', label: 'Description', required: true },
    { name: 'frequency', label: 'Repeats', type: 'select', required: true, half: true, options: enumOptions(['weekly', 'monthly', 'quarterly', 'yearly']) },
    { name: 'startDate', label: 'First date', type: 'date', required: true, half: true },
    { name: 'endDate', label: 'End date', type: 'date', half: true },
    { name: 'autoPost', label: 'Record automatically when due (otherwise just remind me)', type: 'checkbox' },
  ];

  return (
    <Card>
      <CardHeader
        title={`Recurring ${kind}`}
        description="Posted automatically by the scheduler on each due date."
        action={
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={async () => { const r = await api.post<{ posted: number }>('/recurring-rules/run-due'); toast(`${r.posted} due entr${r.posted === 1 ? 'y' : 'ies'} posted`); mutate(); onPosted?.(); }}>
              <Repeat className="h-4 w-4" /> Run due
            </Button>
            <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Schedule</Button>
          </div>
        }
      />
      <DataTable
        rows={data}
        columns={[
          { key: 'name', header: 'Schedule', render: (r) => <div><p className="font-medium">{r.name}</p><p className="text-xs text-muted">{r.accountName}{r.categoryName ? ` · ${r.categoryName}` : ''}</p></div> },
          { key: 'freq', header: 'Repeats', render: (r) => `${titleCase(r.frequency)}${r.autoPost ? '' : ' (reminder)'}` },
          { key: 'next', header: 'Next', render: (r) => (r.isActive ? formatDate(r.nextRunOn) : <Badge>Ended</Badge>) },
          { key: 'amount', header: 'Amount', align: 'right', render: (r) => <Money value={r.amount} /> },
          { key: 'x', header: '', align: 'right', render: (r) => <Button size="sm" variant="ghost" onClick={() => setDeleting(r)}>Delete</Button> },
        ]}
        empty={<EmptyState title={`No recurring ${kind}`} description="Schedule salaries, rent, SIPs or subscriptions once and let Monetra record them." />}
      />
      <FormModal
        open={open}
        onClose={() => setOpen(false)}
        title={`Schedule recurring ${kind}`}
        fields={fields}
        initial={{ kind, frequency: 'monthly', startDate: todayISO(), autoPost: true, accountId: accounts[0]?.value ?? '' }}
        onSubmit={async (v) => {
          await api.post('/recurring-rules', { ...cleanValues(v), kind });
          toast('Schedule created');
          mutate();
        }}
      />
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} title="Delete schedule" message="Entries already recorded are kept." danger confirmLabel="Delete" onConfirm={async () => { await api.delete(`/recurring-rules/${deleting!.id}`); mutate(); }} />
    </Card>
  );
}
