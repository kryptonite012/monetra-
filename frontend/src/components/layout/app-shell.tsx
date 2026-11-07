'use client';
import { Bell, LogOut, Menu, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { useApi } from '@/lib/hooks';
import { ThemeToggle } from '../theme';
import { NAV } from './nav';

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { user } = useAuth();
  return (
    <nav className="flex h-full flex-col gap-6 overflow-y-auto px-3 py-5" aria-label="Main">
      <Link href="/dashboard" className="flex items-center gap-2 px-3 text-lg font-semibold tracking-tight" onClick={onNavigate}>
        <img src="/favicon.svg" alt="" className="h-8 w-8" /> Monetra
      </Link>
      {NAV.map((group) => {
        const items = group.items.filter((i) => !i.adminOnly || user?.role === 'admin' || user?.role === 'support');
        return (
          <div key={group.section}>
            <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted/80">{group.section}</p>
            <ul className="space-y-0.5">
              {items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      className={cn('flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors', active ? 'bg-brand-soft font-medium text-brand' : 'text-muted hover:bg-surface-2 hover:text-text')}
                    >
                      <Icon className="h-4 w-4" /> {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const { data: unread } = useApi<{ unread: number }>('/notifications/unread-count', { refreshInterval: 60_000 });
  const name = user?.profile?.displayName || user?.profile?.fullName || user?.email || '';
  const initials = name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[256px_1fr]">
      <aside className="sticky top-0 hidden h-screen border-r border-border bg-surface lg:block">
        <Sidebar />
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="animate-in absolute inset-y-0 left-0 w-72 border-r border-border bg-surface">
            <button className="absolute right-3 top-4 rounded-lg p-1 text-muted" onClick={() => setOpen(false)} aria-label="Close menu">
              <X className="h-5 w-5" />
            </button>
            <Sidebar onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}
      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-border bg-bg/80 px-4 backdrop-blur sm:px-6">
          <button className="rounded-xl p-2 text-muted hover:bg-surface-2 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <div className="hidden text-sm text-muted lg:block">
            {user && !user.emailVerified && (
              <Link href="/settings/security" className="rounded-full bg-warning/10 px-3 py-1 text-xs font-medium text-warning">
                Verify your email to secure your account
              </Link>
            )}
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <Link href="/notifications" className="relative rounded-xl p-2 text-muted hover:bg-surface-2 hover:text-text" aria-label="Notifications">
              <Bell className="h-5 w-5" />
              {!!unread?.unread && <span className="num absolute right-1 top-1 min-w-4 rounded-full bg-negative px-1 text-center text-[10px] font-semibold leading-4 text-white">{unread.unread > 9 ? '9+' : unread.unread}</span>}
            </Link>
            <Link href="/settings/profile" className="ml-1 flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-surface-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white dark:text-[#04201d]">{initials || 'M'}</span>
              <span className="hidden max-w-36 truncate text-sm font-medium sm:block">{name}</span>
            </Link>
            <button onClick={logout} className="rounded-xl p-2 text-muted hover:bg-surface-2 hover:text-text" aria-label="Sign out" title="Sign out">
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
