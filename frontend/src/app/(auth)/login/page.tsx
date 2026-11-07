'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { Button, Field, Input } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

function LoginForm() {
  const { login, completeMfa, status } = useAuth();
  const router = useRouter();
  const next = useSearchParams().get('next') || '/dashboard';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status === 'authenticated') router.replace(next.startsWith('/') ? next : '/dashboard');
  }, [status, router, next]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (!mfaToken) {
        const res = await login(email, password);
        if (res.mfaRequired && res.mfaToken) setMfaToken(res.mfaToken);
      } else {
        await completeMfa(mfaToken, useRecovery ? { recoveryCode: code } : { code });
      }
    } catch (err) {
      const e = err as ApiError;
      if (e.code === 'MFA_CHALLENGE_EXPIRED') setMfaToken(null);
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{mfaToken ? 'Two-step verification' : 'Welcome back'}</h1>
        <p className="mt-1 text-sm text-muted">{mfaToken ? (useRecovery ? 'Enter one of your recovery codes.' : 'Enter the 6-digit code from your authenticator app.') : 'Sign in to your Monetra account.'}</p>
      </div>
      {error && <div className="rounded-xl border border-negative/30 bg-negative/10 px-3 py-2 text-sm text-negative" role="alert">{error}</div>}
      {!mfaToken ? (
        <>
          <Field label="Email" htmlFor="email">
            <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label={<span className="flex justify-between">Password <Link href="/forgot-password" className="text-brand hover:underline">Forgot?</Link></span>} htmlFor="password">
            <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
        </>
      ) : (
        <Field label={useRecovery ? 'Recovery code' : 'Authentication code'} htmlFor="code">
          <Input
            id="code"
            autoFocus
            inputMode={useRecovery ? 'text' : 'numeric'}
            autoComplete="one-time-code"
            placeholder={useRecovery ? 'ABCDE-FGHIJ' : '123456'}
            value={code}
            onChange={(e) => setCode(useRecovery ? e.target.value : e.target.value.replace(/\D/g, '').slice(0, 6))}
            className="num tracking-widest"
          />
        </Field>
      )}
      <Button type="submit" className="w-full justify-center" size="lg" loading={busy}>
        {mfaToken ? 'Verify' : 'Sign in'}
      </Button>
      {mfaToken ? (
        <button type="button" className="w-full text-center text-xs text-brand hover:underline" onClick={() => { setUseRecovery(!useRecovery); setCode(''); }}>
          {useRecovery ? 'Use authenticator code instead' : 'Use a recovery code'}
        </button>
      ) : (
        <p className="text-center text-sm text-muted">
          New to Monetra? <Link href="/register" className="font-medium text-brand hover:underline">Create an account</Link>
        </p>
      )}
    </form>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
