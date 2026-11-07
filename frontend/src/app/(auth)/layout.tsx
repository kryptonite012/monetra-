import { ShieldCheck, Sparkles, TrendingUp } from 'lucide-react';
import type { ReactNode } from 'react';
import { ThemeToggle } from '@/components/theme';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-[#06201d] p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-teal-400/20 blur-3xl" />
        <div className="absolute -bottom-32 left-10 h-96 w-96 rounded-full bg-indigo-500/20 blur-3xl" />
        <div className="relative flex items-center gap-2 text-lg font-semibold tracking-tight">
          <img src="/favicon.svg" alt="" className="h-8 w-8" /> Monetra
        </div>
        <div className="relative max-w-md">
          <h2 className="text-4xl font-semibold leading-tight tracking-tight">Every rupee, one command centre.</h2>
          <p className="mt-4 text-teal-100/80">Accounts, spending, budgets, EMIs, investments and goals, with insights that explain themselves.</p>
          <ul className="mt-8 space-y-4 text-sm text-teal-50/90">
            <li className="flex gap-3"><ShieldCheck className="h-5 w-5 shrink-0 text-teal-300" /> Two-factor sign-in, encrypted personal data and an immutable ledger.</li>
            <li className="flex gap-3"><TrendingUp className="h-5 w-5 shrink-0 text-teal-300" /> Net worth, cash flow and a transparent financial health score.</li>
            <li className="flex gap-3"><Sparkles className="h-5 w-5 shrink-0 text-teal-300" /> Ask questions like “Can I afford ₹50,000?” and see the maths.</li>
          </ul>
        </div>
        <p className="relative text-xs text-teal-100/60">Monetra never asks for bank passwords, UPI PINs, card CVVs or OTPs.</p>
      </aside>
      <main className="relative flex items-center justify-center p-6">
        <div className="absolute right-4 top-4">
          <ThemeToggle />
        </div>
        <div className="w-full max-w-sm animate-in">{children}</div>
      </main>
    </div>
  );
}
