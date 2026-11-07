'use client';
import { titleCase } from './format';
import { useApi } from './hooks';
import type { Account, Category, PaymentMethod } from './types';

export function useAccounts(includeClosed = false) {
  return useApi<Account[]>(`/accounts${includeClosed ? '?includeClosed=true' : ''}`);
}

export function useAccountOptions() {
  const { data } = useAccounts();
  return (data ?? []).map((a) => ({ value: a.id, label: `${a.name}${a.accountNumberLast4 ? ` ••${a.accountNumberLast4}` : ''}` }));
}

/** Category options with sub-categories indented under their parent. */
export function useCategoryOptions(kind: 'income' | 'expense' | 'transfer') {
  const { data } = useApi<Category[]>(`/categories?kind=${kind}&tree=true`);
  const out: Array<{ value: string; label: string }> = [];
  for (const c of data ?? []) {
    out.push({ value: c.id, label: c.name });
    for (const child of c.children ?? []) out.push({ value: child.id, label: `   ↳ ${child.name}` });
  }
  return out;
}

export function usePaymentMethodOptions(type?: string) {
  const { data } = useApi<PaymentMethod[]>('/payment-methods');
  return (data ?? []).filter((p) => p.isActive && (!type || p.type === type)).map((p) => ({ value: p.id, label: `${p.label} (${titleCase(p.type)})` }));
}

export const enumOptions = (values: readonly string[]) => values.map((v) => ({ value: v, label: titleCase(v) }));
