'use client';
import useSWR, { type SWRConfiguration } from 'swr';
import { fetcher } from './api';
import { useAuth } from './auth';

/** SWR wrapper that only fetches once the session is ready. */
export function useApi<T>(path: string | null, config?: SWRConfiguration<T>) {
  const { status } = useAuth();
  return useSWR<T>(status === 'authenticated' && path ? path : null, fetcher as (p: string) => Promise<T>, { revalidateOnFocus: false, ...config });
}

export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : '';
}
