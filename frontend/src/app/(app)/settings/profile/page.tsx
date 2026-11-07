'use client';
import { Download, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTheme } from '@/components/theme';
import { Button, Card, CardBody, CardHeader, Field, Input, Modal, PageHeader, Select, useToast } from '@/components/ui';
import { api, ApiError, downloadFile, setAccessToken } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const NOTIFICATION_TYPES: Array<[string, string]> = [
  ['securityAlert', 'Security alerts'],
  ['billDue', 'Bill reminders'],
  ['emiDue', 'EMI reminders'],
  ['subscriptionRenewal', 'Subscription renewals'],
  ['budgetThreshold', 'Budget thresholds'],
  ['unusualSpending', 'Unusual spending'],
  ['goalMilestone', 'Goal milestones'],
  ['accountActivity', 'Account activity'],
];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function ProfilePage() {
  const { user, reload } = useAuth();
  const { theme, setTheme } = useTheme();
  const toast = useToast();
  const p = user?.profile;
  const [form, setForm] = useState<Record<string, string>>({});
  const [inApp, setInApp] = useState<Record<string, boolean>>({});
  const [email, setEmail] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [del, setDel] = useState({ password: '', confirmation: '', code: '' });

  useEffect(() => {
    if (!p) return;
    setForm({
      fullName: p.fullName ?? '',
      displayName: p.displayName ?? '',
      dateOfBirth: p.dateOfBirth ?? '',
      occupation: p.occupation ?? '',
      employmentType: p.employmentType ?? '',
      city: p.city ?? '',
      state: p.state ?? '',
      monthlyIncomeEstimate: p.monthlyIncomeEstimate ?? '',
      financialYearStartMonth: String(p.financialYearStartMonth ?? 4),
      timezone: p.timezone ?? 'Asia/Kolkata',
    });
    setInApp(p.preferences?.inAppNotifications ?? {});
    setEmail({ securityAlert: true, ...(p.preferences?.emailNotifications ?? {}) });
  }, [p]);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  async function saveProfile() {
    setBusy(true);
    try {
      await api.patch('/me/profile', {
        fullName: form.fullName,
        displayName: form.displayName || null,
        dateOfBirth: form.dateOfBirth || null,
        occupation: form.occupation || null,
        employmentType: form.employmentType || null,
        city: form.city || null,
        state: form.state || null,
        monthlyIncomeEstimate: form.monthlyIncomeEstimate || null,
        financialYearStartMonth: Number(form.financialYearStartMonth),
        timezone: form.timezone,
      });
      await reload();
      toast('Profile saved');
    } catch (err) {
      const e = err as ApiError;
      toast(Object.values(e.fieldErrors())[0] ?? e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Profile" description="Your details, preferences and data controls." />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Personal details" />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name"><Input value={form.fullName ?? ''} onChange={set('fullName')} /></Field>
            <Field label="Display name"><Input value={form.displayName ?? ''} onChange={set('displayName')} /></Field>
            <Field label="Date of birth"><Input type="date" value={form.dateOfBirth ?? ''} onChange={set('dateOfBirth')} /></Field>
            <Field label="Occupation"><Input value={form.occupation ?? ''} onChange={set('occupation')} /></Field>
            <Field label="Employment type">
              <Select value={form.employmentType ?? ''} onChange={set('employmentType')}>
                <option value="">—</option>
                {['salaried', 'self_employed', 'business', 'student', 'retired', 'homemaker', 'other'].map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
              </Select>
            </Field>
            <Field label="Monthly income estimate (₹)"><Input className="num" value={form.monthlyIncomeEstimate ?? ''} onChange={(e) => setForm({ ...form, monthlyIncomeEstimate: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
            <Field label="City"><Input value={form.city ?? ''} onChange={set('city')} /></Field>
            <Field label="State"><Input value={form.state ?? ''} onChange={set('state')} /></Field>
            <Field label="Financial year starts in">
              <Select value={form.financialYearStartMonth ?? '4'} onChange={set('financialYearStartMonth')}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</Select>
            </Field>
            <Field label="Time zone"><Input value={form.timezone ?? ''} onChange={set('timezone')} /></Field>
            <div className="sm:col-span-2"><Button loading={busy} onClick={saveProfile}>Save details</Button></div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Appearance" />
          <CardBody>
            <Field label="Theme">
              <Select value={theme} onChange={async (e) => { const t = e.target.value as 'light' | 'dark' | 'system'; setTheme(t); await api.patch('/me/preferences', { theme: t }); }}>
                <option value="system">Match my device</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </Select>
            </Field>
            <p className="mt-4 text-xs text-muted">Base currency: {p?.baseCurrency} · Locale: {p?.locale}</p>
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader title="Notifications" description="Choose what appears in the app and what is also emailed to you. Security alerts always appear in the app." />
        <CardBody>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted"><th className="py-2">Alert</th><th className="py-2 text-center">In app</th><th className="py-2 text-center">Email</th></tr></thead>
              <tbody>
                {NOTIFICATION_TYPES.map(([key, label]) => (
                  <tr key={key} className="border-t border-border/60">
                    <td className="py-2.5">{label}</td>
                    <td className="py-2.5 text-center"><input type="checkbox" aria-label={`${label} in app`} disabled={key === 'securityAlert'} checked={key === 'securityAlert' || inApp[key] !== false} onChange={(e) => setInApp({ ...inApp, [key]: e.target.checked })} /></td>
                    <td className="py-2.5 text-center"><input type="checkbox" aria-label={`${label} by email`} checked={Boolean(email[key])} onChange={(e) => setEmail({ ...email, [key]: e.target.checked })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button className="mt-4" variant="secondary" onClick={async () => { await api.patch('/me/preferences', { inAppNotifications: inApp, emailNotifications: email }); await reload(); toast('Notification preferences saved'); }}>Save preferences</Button>
        </CardBody>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader title="Export your data" description="Download everything Monetra stores about you as JSON. Passwords and secrets are excluded." />
          <CardBody><Button variant="secondary" onClick={() => downloadFile('/me/export', 'monetra-export.json')}><Download className="h-4 w-4" /> Download my data</Button></CardBody>
        </Card>
        <Card className="border-negative/30">
          <CardHeader title="Delete account" description="Permanently erases your account, ledger, receipts and reports. This cannot be undone." />
          <CardBody><Button variant="danger" onClick={() => setDeleting(true)}><Trash2 className="h-4 w-4" /> Delete my account</Button></CardBody>
        </Card>
      </div>
      <Modal
        open={deleting}
        onClose={() => setDeleting(false)}
        title="Delete your account permanently?"
        size="sm"
        footer={
          <Button
            variant="danger"
            loading={busy}
            disabled={del.confirmation !== 'DELETE MY ACCOUNT' || !del.password}
            onClick={async () => {
              setBusy(true);
              try {
                await api.delete('/me', { password: del.password, confirmation: del.confirmation, code: del.code || undefined });
                setAccessToken(null);
                window.location.href = '/login';
              } catch (err) {
                toast((err as ApiError).message, 'error');
              } finally {
                setBusy(false);
              }
            }}
          >
            Delete forever
          </Button>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-muted">Consider exporting your data first. Type <strong>DELETE MY ACCOUNT</strong> to confirm.</p>
          <Field label="Confirmation"><Input value={del.confirmation} onChange={(e) => setDel({ ...del, confirmation: e.target.value })} /></Field>
          <Field label="Password"><Input type="password" value={del.password} onChange={(e) => setDel({ ...del, password: e.target.value })} /></Field>
          {user?.mfaEnabled && <Field label="Authenticator code"><Input inputMode="numeric" value={del.code} onChange={(e) => setDel({ ...del, code: e.target.value.replace(/\D/g, '').slice(0, 6) })} /></Field>}
        </div>
      </Modal>
    </div>
  );
}
