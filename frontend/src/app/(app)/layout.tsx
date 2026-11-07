'use client';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { PageLoader } from '@/components/ui';
import { useAuth } from '@/lib/auth';

export default function AppLayout({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === 'unauthenticated') router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    else if (status === 'authenticated' && user?.profile && !user.profile.onboardingCompleted && pathname !== '/onboarding') router.replace('/onboarding');
  }, [status, user, router, pathname]);

  if (status !== 'authenticated') return <PageLoader label="Securing your session" />;
  if (pathname === '/onboarding') return <>{children}</>;
  return <AppShell>{children}</AppShell>;
}
