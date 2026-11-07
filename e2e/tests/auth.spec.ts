import { expect, test } from '@playwright/test';
import { PASSWORD, signUpAndOnboard } from './helpers';

test('sign up, onboard, survive a reload, sign out and sign back in', async ({ page }) => {
  const email = await signUpAndOnboard(page, { balance: '75000' });
  await expect(page.getByText('Available balance')).toBeVisible();
  await expect(page.getByText('₹75,000.00').first()).toBeVisible();

  // The access token lives in memory only; a reload must restore it from the refresh cookie.
  await page.reload();
  await expect(page.getByText('Available balance')).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login/);

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
});

test('rejects a wrong password with a generic message', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('nobody@example.in');
  await page.getByLabel('Password').fill('Wrong#Password1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Incorrect email or password')).toBeVisible();
});
