'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { PasswordHints } from '@/components/auth/password-hints';
import { Button, Checkbox, Field, Input } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function RegisterPage() {
  const { register } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', password: '' });
  const [accept, setAccept] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setErrors({});
    if (!accept) return setError('Please accept the terms and privacy policy.');
    setBusy(true);
    try {
      await register({ fullName: form.fullName, email: form.email, password: form.password, phone: form.phone || undefined, acceptTerms: true });
      router.replace('/onboarding');
    } catch (err) {
      const e = err as ApiError;
      setErrors(e.fieldErrors());
      const problems = (e.details as { problems?: string[] } | undefined)?.problems;
      setError(problems?.length ? problems.join('. ') : e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
        <p className="mt-1 text-sm text-muted">Start tracking your money in minutes.</p>
      </div>
      {error && <div className="rounded-xl border border-negative/30 bg-negative/10 px-3 py-2 text-sm text-negative" role="alert">{error}</div>}
      <Field label="Full name" htmlFor="fullName" error={errors.fullName}>
        <Input id="fullName" autoComplete="name" required value={form.fullName} onChange={set('fullName')} />
      </Field>
      <Field label="Email" htmlFor="email" error={errors.email}>
        <Input id="email" type="email" autoComplete="email" required value={form.email} onChange={set('email')} />
      </Field>
      <Field label="Mobile number (optional)" htmlFor="phone" error={errors.phone} hint="Used for verification and security alerts.">
        <Input id="phone" type="tel" autoComplete="tel" placeholder="+91 98765 43210" value={form.phone} onChange={set('phone')} />
      </Field>
      <Field label="Password" htmlFor="password" error={errors.password}>
        <Input id="password" type="password" autoComplete="new-password" required value={form.password} onChange={set('password')} />
      </Field>
      <PasswordHints password={form.password} />
      <Checkbox checked={accept} onChange={(e) => setAccept(e.target.checked)} label={<span className="text-xs text-muted">I agree to the terms of use and privacy policy.</span>} />
      <Button type="submit" className="w-full justify-center" size="lg" loading={busy}>
        Create account
      </Button>
      <p className="text-center text-sm text-muted">
        Already have an account? <Link href="/login" className="font-medium text-brand hover:underline">Sign in</Link>
      </p>
    </form>
  );
}
