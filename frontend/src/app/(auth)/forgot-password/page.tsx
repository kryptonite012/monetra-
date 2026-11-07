'use client';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Button, Field, Input } from '@/components/ui';
import { api } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    await api.post('/auth/password/forgot', { email }).catch(() => undefined);
    setBusy(false);
    setSent(true);
  }

  return sent ? (
    <div className="space-y-3">
      <h1 className="text-2xl font-semibold tracking-tight">Check your email</h1>
      <p className="text-sm text-muted">If an account exists for {email}, we have sent a link to reset your password. It expires in 30 minutes.</p>
      <Link href="/login" className="text-sm font-medium text-brand hover:underline">Back to sign in</Link>
    </div>
  ) : (
    <form onSubmit={submit} className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
        <p className="mt-1 text-sm text-muted">We will email you a secure link.</p>
      </div>
      <Field label="Email" htmlFor="email">
        <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Button type="submit" className="w-full justify-center" size="lg" loading={busy}>Send reset link</Button>
      <Link href="/login" className="block text-center text-sm text-muted hover:text-text">Back to sign in</Link>
    </form>
  );
}
