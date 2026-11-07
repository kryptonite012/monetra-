'use client';
import { KeyRound, Laptop, Mail, ShieldCheck, Smartphone } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { PasswordHints } from '@/components/auth/password-hints';
import { ConfirmDialog } from '@/components/form-modal';
import { Badge, Button, Card, CardBody, CardHeader, DataTable, Field, Input, Modal, PageHeader, useToast } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateTime, titleCase } from '@/lib/format';
import { useApi } from '@/lib/hooks';

interface Session {
  id: string;
  deviceLabel: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
}
interface LoginEvent {
  id: string;
  success: boolean;
  reason: string | null;
  method: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

function Verification() {
  const { user, reload } = useAuth();
  const toast = useToast();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Card>
      <CardHeader title="Contact verification" description="Verified contacts receive security alerts and recovery links." />
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3">
          <div className="flex items-center gap-3"><Mail className="h-5 w-5 text-muted" /><div><p className="text-sm font-medium">{user?.email}</p><p className="text-xs text-muted">Email</p></div></div>
          {user?.emailVerified ? <Badge tone="positive">Verified</Badge> : <Button size="sm" variant="secondary" onClick={async () => { await api.post('/auth/verify-email/request'); toast('Verification link sent. Check your inbox.'); }}>Send verification link</Button>}
        </div>
        <div className="space-y-3 rounded-xl border border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3"><Smartphone className="h-5 w-5 text-muted" /><div><p className="text-sm font-medium">{user?.phoneLast4 ? `•••• •• ${user.phoneLast4}` : 'No mobile number'}</p><p className="text-xs text-muted">Mobile</p></div></div>
            {user?.phoneVerified && <Badge tone="positive">Verified</Badge>}
          </div>
          {!sent ? (
            <div className="flex gap-2">
              <Input placeholder={user?.phoneLast4 ? 'New number (optional)' : '+91 98765 43210'} value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="Mobile number" />
              <Button
                variant="secondary"
                loading={busy}
                disabled={!phone && !user?.phoneLast4}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api.post('/auth/verify-phone/request', phone ? { phone } : {});
                    setSent(true);
                    toast('Code sent by SMS');
                  } catch (err) {
                    toast((err as ApiError).message, 'error');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {user?.phoneVerified && !phone ? 'Re-verify' : 'Send code'}
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Input className="num tracking-widest" inputMode="numeric" placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} aria-label="SMS code" />
              <Button
                loading={busy}
                disabled={code.length !== 6}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api.post('/auth/verify-phone/confirm', { code });
                    toast('Mobile number verified');
                    setSent(false);
                    setCode('');
                    setPhone('');
                    reload();
                  } catch (err) {
                    toast((err as ApiError).message, 'error');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Verify
              </Button>
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

function ChangePassword() {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.post<{ revokedSessions: number }>('/auth/password/change', { currentPassword: current, newPassword: next });
      toast(`Password changed. ${r.revokedSessions} other session(s) signed out.`);
      setCurrent('');
      setNext('');
    } catch (err) {
      const e = err as ApiError;
      toast(Object.values(e.fieldErrors())[0] ?? (e.details as { problems?: string[] })?.problems?.[0] ?? e.message, 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader title="Password" description="Changing it signs out every other device." action={<KeyRound className="h-4 w-4 text-muted" />} />
      <CardBody>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Current password"><Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required /></Field>
          <Field label="New password"><Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required /></Field>
          <PasswordHints password={next} />
          <Button type="submit" loading={busy}>Update password</Button>
        </form>
      </CardBody>
    </Card>
  );
}

function TwoFactor() {
  const toast = useToast();
  const { reload } = useAuth();
  const { data: status, mutate } = useApi<{ enabled: boolean; enabledAt: string | null; recoveryCodesRemaining: number }>('/auth/mfa');
  const [setup, setSetup] = useState<{ secret: string; qrDataUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [disabling, setDisabling] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toast((err as ApiError).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader title="Two-factor authentication" description="Require a code from an authenticator app (Google Authenticator, Microsoft Authenticator, Authy) when signing in." action={status?.enabled ? <Badge tone="positive"><ShieldCheck className="h-3 w-3" /> On</Badge> : <Badge tone="warning">Off</Badge>} />
      <CardBody className="space-y-4">
        {status?.enabled ? (
          <>
            <p className="text-sm text-muted">Enabled {formatDateTime(status.enabledAt)} · {status.recoveryCodesRemaining} recovery codes left.</p>
            <div className="flex flex-wrap gap-2">
              <Input className="num w-40 tracking-widest" inputMode="numeric" placeholder="Current code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} aria-label="Authenticator code" />
              <Button variant="secondary" loading={busy} disabled={code.length !== 6} onClick={() => run(async () => { const r = await api.post<{ recoveryCodes: string[] }>('/auth/mfa/recovery-codes', { code }); setCodes(r.recoveryCodes); setCode(''); mutate(); })}>New recovery codes</Button>
              <Button variant="ghost" onClick={() => setDisabling(true)}>Turn off</Button>
            </div>
          </>
        ) : setup ? (
          <div className="flex flex-col gap-4 sm:flex-row">
            <img src={setup.qrDataUrl} alt="Scan this QR code with your authenticator app" className="h-44 w-44 rounded-xl border border-border bg-white p-2" />
            <div className="space-y-3">
              <p className="text-sm">Scan the code, or enter this key manually:</p>
              <code className="block break-all rounded-lg bg-surface-2 px-3 py-2 text-xs">{setup.secret}</code>
              <Field label="Enter the 6-digit code to confirm"><Input className="num tracking-widest" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} /></Field>
              <Button loading={busy} disabled={code.length !== 6} onClick={() => run(async () => { const r = await api.post<{ recoveryCodes: string[] }>('/auth/mfa/enable', { code }); setCodes(r.recoveryCodes); setSetup(null); setCode(''); mutate(); reload(); })}>Enable</Button>
            </div>
          </div>
        ) : (
          <Button loading={busy} onClick={() => run(async () => setSetup(await api.post('/auth/mfa/setup')))}>Set up two-factor authentication</Button>
        )}
      </CardBody>
      <Modal open={!!codes} onClose={() => setCodes(null)} title="Save your recovery codes" description="Each code works once if you lose access to your authenticator. They will not be shown again." footer={<Button onClick={() => { navigator.clipboard?.writeText(codes?.join('\n') ?? ''); toast('Copied'); }}>Copy codes</Button>}>
        <ul className="grid grid-cols-2 gap-2">{codes?.map((c) => <li key={c} className="num rounded-lg bg-surface-2 px-3 py-2 text-center font-mono text-sm">{c}</li>)}</ul>
      </Modal>
      <Modal
        open={disabling}
        onClose={() => setDisabling(false)}
        title="Turn off two-factor authentication"
        size="sm"
        footer={<Button variant="danger" loading={busy} onClick={() => run(async () => { await api.post('/auth/mfa/disable', /^\d{6}$/.test(code) ? { password, code } : { password, recoveryCode: code }); setDisabling(false); setPassword(''); setCode(''); mutate(); reload(); toast('Two-factor authentication disabled'); })}>Turn off</Button>}
      >
        <div className="space-y-3">
          <Field label="Password"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          <Field label="Authenticator or recovery code"><Input value={code} onChange={(e) => setCode(e.target.value)} /></Field>
        </div>
      </Modal>
    </Card>
  );
}

export default function SecurityPage() {
  const toast = useToast();
  const { data: sessions, mutate } = useApi<Session[]>('/auth/sessions');
  const { data: activity } = useApi<LoginEvent[]>('/auth/login-activity?pageSize=15');
  const { data: audit } = useApi<Array<{ id: number; action: string; ip: string | null; createdAt: string }>>('/audit-logs?pageSize=15');
  const [revokeAll, setRevokeAll] = useState(false);

  return (
    <div className="space-y-6">
      <PageHeader title="Security" description="Sign-in protection, devices and a full record of account activity. Monetra never asks for bank passwords, UPI PINs, CVVs or OTPs." />
      <div className="grid gap-4 lg:grid-cols-2">
        <TwoFactor />
        <ChangePassword />
        <Verification />
        <Card>
          <CardHeader title="Active sessions" description="Devices currently signed in" action={<Button size="sm" variant="ghost" onClick={() => setRevokeAll(true)}>Sign out others</Button>} />
          <CardBody className="space-y-2">
            {sessions?.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2">
                <div className="flex items-center gap-3">
                  <Laptop className="h-4 w-4 text-muted" />
                  <div>
                    <p className="text-sm font-medium">{s.deviceLabel ?? 'Unknown device'} {s.current && <Badge tone="brand">This device</Badge>}</p>
                    <p className="text-xs text-muted">{s.ip ?? 'unknown IP'} · active {formatDateTime(s.lastUsedAt)}</p>
                  </div>
                </div>
                {!s.current && <Button size="sm" variant="ghost" onClick={async () => { await api.delete(`/auth/sessions/${s.id}`); toast('Device signed out'); mutate(); }}>Revoke</Button>}
              </div>
            ))}
          </CardBody>
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Recent sign-in activity" />
          <DataTable
            rows={activity}
            loading={!activity}
            columns={[
              { key: 'when', header: 'When', render: (e) => <span className="text-xs">{formatDateTime(e.createdAt)}</span> },
              { key: 'res', header: 'Result', render: (e) => (e.success ? <Badge tone="positive">{e.reason === 'mfa_pending' ? 'Password OK' : 'Success'}</Badge> : <Badge tone="negative">{titleCase(e.reason ?? 'failed')}</Badge>) },
              { key: 'ip', header: 'IP', render: (e) => <span className="text-xs text-muted">{e.ip ?? '—'}</span> },
              { key: 'm', header: 'Method', hideOnMobile: true, render: (e) => <span className="text-xs text-muted">{e.method}</span> },
            ]}
          />
        </Card>
        <Card>
          <CardHeader title="Audit trail" description="Append-only record of changes to your account and data" />
          <DataTable
            rows={audit}
            loading={!audit}
            rowKey={(a) => String(a.id)}
            columns={[
              { key: 'when', header: 'When', render: (a) => <span className="text-xs">{formatDateTime(a.createdAt)}</span> },
              { key: 'action', header: 'Action', render: (a) => <code className="text-xs">{a.action}</code> },
              { key: 'ip', header: 'IP', render: (a) => <span className="text-xs text-muted">{a.ip ?? '—'}</span> },
            ]}
          />
        </Card>
      </div>
      <ConfirmDialog open={revokeAll} onClose={() => setRevokeAll(false)} title="Sign out other devices" message="Every session except this one will be signed out immediately." confirmLabel="Sign out others" onConfirm={async () => { const r = await api.post<{ revoked: number }>('/auth/sessions/revoke-others'); toast(`${r.revoked} session(s) signed out`); mutate(); }} />
    </div>
  );
}
