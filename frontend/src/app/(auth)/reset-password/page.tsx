'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { PasswordHints } from '@/components/auth/password-hints';
import { Button, Field, Input } from '@/components/ui';
import { api, ApiError } from '@/lib/api';

function ResetForm() {
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/password/reset', { token, password });
      setDone(true);
    } catch (err) {
      const e = err as ApiError;
      setError(Object.values(e.fieldErrors())[0] ?? e.message);
    } finally {
      setBusy(false);
    }
  }

  if (done)
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Password updated</h1>
        <p className="text-sm text-muted">All devices were signed out for your security.</p>
        <Link href="/login" className="text-sm font-medium text-brand hover:underline">Sign in with your new password</Link>
      </div>
    );
  return (
    <form onSubmit={submit} className="space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
      {!token && <p className="text-sm text-negative">This link is missing its token. Request a new one.</p>}
      {error && <div className="rounded-xl border border-negative/30 bg-negative/10 px-3 py-2 text-sm text-negative">{error}</div>}
      <Field label="New password" htmlFor="password">
        <Input id="password" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <PasswordHints password={password} />
      <Button type="submit" className="w-full justify-center" size="lg" loading={busy} disabled={!token}>Update password</Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
