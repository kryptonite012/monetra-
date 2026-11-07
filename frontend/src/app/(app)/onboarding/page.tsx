'use client';
import { Check, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ThemeToggle, useTheme } from '@/components/theme';
import { Button, Card, Checkbox, Field, Input, Select, useToast } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';

const ACCOUNT_TYPES = [
  ['savings', 'Savings account'],
  ['salary', 'Salary account'],
  ['current', 'Current account'],
  ['cash', 'Cash in hand'],
  ['wallet', 'Wallet (Paytm, Amazon Pay…)'],
  ['credit_card', 'Credit card'],
];

interface DraftAccount {
  name: string;
  type: string;
  institutionName: string;
  openingBalance: string;
}

export default function OnboardingPage() {
  const { user, reload } = useAuth();
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState({ occupation: '', employmentType: 'salaried', city: '', state: '', monthlyIncomeEstimate: '' });
  const [accounts, setAccounts] = useState<DraftAccount[]>([{ name: 'Savings account', type: 'savings', institutionName: '', openingBalance: '' }, { name: 'Cash in hand', type: 'cash', institutionName: '', openingBalance: '' }]);
  const [alerts, setAlerts] = useState({ billDue: true, emiDue: true, budgetThreshold: true, unusualSpending: true });

  const steps = ['About you', 'Your accounts', 'Preferences'];

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      for (const a of accounts.filter((x) => x.name.trim())) {
        await api.post('/accounts', { name: a.name.trim(), type: a.type, institutionName: a.institutionName || undefined, openingBalance: a.openingBalance || '0' });
      }
      await api.patch('/me/preferences', { theme, emailNotifications: alerts });
      await api.post('/me/onboarding', {
        occupation: profile.occupation || undefined,
        employmentType: profile.employmentType || undefined,
        city: profile.city || undefined,
        state: profile.state || undefined,
        monthlyIncomeEstimate: profile.monthlyIncomeEstimate || undefined,
      });
      await reload();
      toast('Welcome to Monetra! Your workspace is ready.');
      router.replace('/dashboard');
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-2 text-lg font-semibold">
            <img src="/favicon.svg" alt="" className="h-8 w-8" /> Monetra
          </div>
          <ThemeToggle />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome, {user?.profile?.fullName?.split(' ')[0]} 👋</h1>
        <p className="mt-1 text-sm text-muted">Three quick steps to set up your financial command centre. You can change everything later.</p>
        <ol className="my-6 flex gap-2">
          {steps.map((s, i) => (
            <li key={s} className={cn('flex flex-1 items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium', i === step ? 'border-brand bg-brand-soft text-brand' : i < step ? 'border-border text-positive' : 'border-border text-muted')}>
              <span className={cn('flex h-5 w-5 items-center justify-center rounded-full text-[10px]', i < step ? 'bg-positive text-white' : 'bg-surface-3')}>{i < step ? <Check className="h-3 w-3" /> : i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
        <Card className="animate-in p-6">
          {error && <div className="mb-4 rounded-xl border border-negative/30 bg-negative/10 px-3 py-2 text-sm text-negative">{error}</div>}
          {step === 0 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Occupation">
                <Input value={profile.occupation} onChange={(e) => setProfile({ ...profile, occupation: e.target.value })} placeholder="Software engineer" />
              </Field>
              <Field label="Employment type">
                <Select value={profile.employmentType} onChange={(e) => setProfile({ ...profile, employmentType: e.target.value })}>
                  {['salaried', 'self_employed', 'business', 'student', 'retired', 'homemaker', 'other'].map((t) => (
                    <option key={t} value={t}>{t.replace('_', ' ')}</option>
                  ))}
                </Select>
              </Field>
              <Field label="City">
                <Input value={profile.city} onChange={(e) => setProfile({ ...profile, city: e.target.value })} placeholder="Bengaluru" />
              </Field>
              <Field label="State">
                <Input value={profile.state} onChange={(e) => setProfile({ ...profile, state: e.target.value })} placeholder="Karnataka" />
              </Field>
              <Field label="Approximate monthly take-home income (₹)" className="sm:col-span-2" hint="Used only to personalise insights before you record income.">
                <Input inputMode="decimal" className="num" value={profile.monthlyIncomeEstimate} onChange={(e) => setProfile({ ...profile, monthlyIncomeEstimate: e.target.value.replace(/[^\d.]/g, '') })} placeholder="75000" />
              </Field>
            </div>
          )}
          {step === 1 && (
            <div className="space-y-3">
              <p className="text-sm text-muted">Add the accounts you use. Enter today&apos;s balance; for credit cards enter the amount you owe as a negative number. Monetra does not connect to your bank, so nothing is fetched automatically.</p>
              {accounts.map((a, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 rounded-xl border border-border p-3">
                  <Input className="col-span-12 sm:col-span-4" value={a.name} onChange={(e) => setAccounts(accounts.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Account name" aria-label="Account name" />
                  <Select className="col-span-6 sm:col-span-3" value={a.type} onChange={(e) => setAccounts(accounts.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))} aria-label="Type">
                    {ACCOUNT_TYPES.map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </Select>
                  <Input className="num col-span-5 sm:col-span-4" inputMode="decimal" value={a.openingBalance} onChange={(e) => setAccounts(accounts.map((x, j) => (j === i ? { ...x, openingBalance: e.target.value.replace(/[^\d.-]/g, '') } : x)))} placeholder="Balance ₹" aria-label="Opening balance" />
                  <button className="col-span-1 flex items-center justify-center text-muted hover:text-negative" onClick={() => setAccounts(accounts.filter((_, j) => j !== i))} aria-label="Remove account">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <Button variant="secondary" size="sm" onClick={() => setAccounts([...accounts, { name: '', type: 'savings', institutionName: '', openingBalance: '' }])}>
                <Plus className="h-4 w-4" /> Add another account
              </Button>
            </div>
          )}
          {step === 2 && (
            <div className="space-y-5">
              <Field label="Appearance">
                <Select value={theme} onChange={(e) => setTheme(e.target.value as 'light' | 'dark' | 'system')}>
                  <option value="system">Match my device</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </Select>
              </Field>
              <div>
                <p className="mb-2 text-xs font-medium text-muted">Email me about</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Checkbox checked={alerts.billDue} onChange={(e) => setAlerts({ ...alerts, billDue: e.target.checked })} label="Upcoming bills" />
                  <Checkbox checked={alerts.emiDue} onChange={(e) => setAlerts({ ...alerts, emiDue: e.target.checked })} label="EMI due dates" />
                  <Checkbox checked={alerts.budgetThreshold} onChange={(e) => setAlerts({ ...alerts, budgetThreshold: e.target.checked })} label="Budget limits" />
                  <Checkbox checked={alerts.unusualSpending} onChange={(e) => setAlerts({ ...alerts, unusualSpending: e.target.checked })} label="Unusual spending" />
                </div>
                <p className="mt-2 text-xs text-muted">Security alerts are always sent.</p>
              </div>
            </div>
          )}
          <div className="mt-6 flex justify-between">
            <Button variant="ghost" onClick={() => setStep(step - 1)} disabled={step === 0}>Back</Button>
            {step < 2 ? <Button onClick={() => setStep(step + 1)}>Continue</Button> : <Button loading={busy} onClick={finish}>Finish setup</Button>}
          </div>
        </Card>
      </div>
    </div>
  );
}
