import { expect, type Page } from '@playwright/test';

export const PASSWORD = 'Monsoon#Ledger42';

export function uniqueEmail(prefix = 'e2e') {
  return `${prefix}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.in`;
}

/** Signs up through the UI and completes onboarding with one bank account. */
export async function signUpAndOnboard(page: Page, opts: { name?: string; balance?: string } = {}) {
  const email = uniqueEmail();
  await page.goto('/register');
  await page.getByLabel('Full name').fill(opts.name ?? 'Isha Rao');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Opening balance').first().fill(opts.balance ?? '50000');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Finish setup' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  return email;
}
