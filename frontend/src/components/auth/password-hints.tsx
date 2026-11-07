import { Check, X } from 'lucide-react';
import { cn } from '@/lib/cn';

/** Mirrors the server's password policy so users get instant feedback. */
export function passwordChecks(pw: string) {
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  return [
    { ok: pw.length >= 10, label: 'At least 10 characters' },
    { ok: classes >= 3, label: 'Three of: lowercase, uppercase, digit, symbol' },
    { ok: pw.length > 0 && !/(.)\1{3,}/.test(pw), label: 'No long runs of the same character' },
  ];
}

export function PasswordHints({ password }: { password: string }) {
  return (
    <ul className="space-y-1 text-xs">
      {passwordChecks(password).map((c) => (
        <li key={c.label} className={cn('flex items-center gap-1.5', c.ok ? 'text-positive' : 'text-muted')}>
          {c.ok ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />} {c.label}
        </li>
      ))}
    </ul>
  );
}
