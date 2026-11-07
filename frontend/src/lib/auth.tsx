'use client';
import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, refreshSession, setAccessToken, setSessionExpiredHandler } from './api';
import type { User } from './types';

type Status = 'loading' | 'authenticated' | 'unauthenticated';

interface LoginResponse {
  mfaRequired: boolean;
  mfaToken?: string;
  accessToken?: string;
  user?: User;
}

interface AuthContextValue {
  user: User | null;
  status: Status;
  login: (email: string, password: string) => Promise<LoginResponse>;
  completeMfa: (mfaToken: string, factor: { code?: string; recoveryCode?: string }) => Promise<void>;
  register: (input: { email: string; password: string; fullName: string; phone?: string; acceptTerms: true }) => Promise<void>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const router = useRouter();

  const reload = useCallback(async () => {
    const me = await api.get<User>('/me');
    setUser(me);
    setStatus('authenticated');
  }, []);

  useEffect(() => {
    setSessionExpiredHandler(() => {
      setAccessToken(null);
      setUser(null);
      setStatus('unauthenticated');
    });
    // Restore the session from the refresh cookie on first load.
    refreshSession()
      .then(async (token) => {
        if (!token) return setStatus('unauthenticated');
        await reload();
      })
      .catch(() => setStatus('unauthenticated'));
  }, [reload]);

  const finish = useCallback((data: LoginResponse) => {
    if (data.accessToken && data.user) {
      setAccessToken(data.accessToken);
      setUser(data.user);
      setStatus('authenticated');
    }
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const data = await api.post<LoginResponse>('/auth/login', { email, password });
      if (!data.mfaRequired) finish(data);
      return data;
    },
    [finish],
  );

  const completeMfa = useCallback(
    async (mfaToken: string, factor: { code?: string; recoveryCode?: string }) => {
      finish(await api.post<LoginResponse>('/auth/login/mfa', { mfaToken, ...factor }));
    },
    [finish],
  );

  const register = useCallback(
    async (input: { email: string; password: string; fullName: string; phone?: string; acceptTerms: true }) => {
      finish(await api.post<LoginResponse>('/auth/register', input));
    },
    [finish],
  );

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => undefined);
    setAccessToken(null);
    setUser(null);
    setStatus('unauthenticated');
    router.replace('/login');
  }, [router]);

  const value = useMemo(() => ({ user, status, login, completeMfa, register, logout, reload }), [user, status, login, completeMfa, register, logout, reload]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
