'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { Spinner } from '@/components/ui';
import { api, ApiError } from '@/lib/api';

function Verify() {
  const token = useSearchParams().get('token');
  const [state, setState] = useState<'working' | 'done' | 'error'>('working');
  const [message, setMessage] = useState('');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!token) {
      setState('error');
      setMessage('This link is missing its verification token.');
      return;
    }
    api
      .post('/auth/verify-email/confirm', { token })
      .then(() => setState('done'))
      .catch((err: ApiError) => {
        setState('error');
        setMessage(err.message);
      });
  }, [token]);

  return (
    <div className="space-y-3">
      {state === 'working' && (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Spinner /> Verifying your email…
        </p>
      )}
      {state === 'done' && (
        <>
          <h1 className="text-2xl font-semibold tracking-tight">Email verified</h1>
          <p className="text-sm text-muted">Thanks! Your email address is confirmed.</p>
        </>
      )}
      {state === 'error' && (
        <>
          <h1 className="text-2xl font-semibold tracking-tight">Verification failed</h1>
          <p className="text-sm text-muted">{message} You can request a new link from your security settings.</p>
        </>
      )}
      <Link href="/dashboard" className="text-sm font-medium text-brand hover:underline">Go to dashboard</Link>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <Verify />
    </Suspense>
  );
}
