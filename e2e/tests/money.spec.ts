import { expect, test } from '@playwright/test';
import { signUpAndOnboard } from './helpers';

test('records an expense, sees it in the ledger and asks the assistant about it', async ({ page }) => {
  await signUpAndOnboard(page, { balance: '50000' });

  await page.goto('/expenses');
  await page.getByRole('button', { name: 'Add expense' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Amount (₹)').fill('1249.50');
  await dialog.getByLabel('What was it for?').fill('Zepto groceries');
  await dialog.getByLabel('Merchant (optional)').fill('Zepto');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('cell', { name: /Zepto groceries/ })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Groceries', exact: true })).toBeVisible();

  await page.goto('/transactions');
  await expect(page.getByText('Zepto groceries')).toBeVisible();
  await expect(page.getByRole('table').getByText('-₹1,249.50')).toBeVisible();

  await page.goto('/accounts');
  await expect(page.getByText('₹48,750.50').first()).toBeVisible();

  await page.goto('/assistant');
  await page.getByLabel('Your question').fill('Where did my money go this month?');
  await page.getByRole('button', { name: 'Ask' }).click();
  await expect(page.getByText(/You spent ₹1,249\.50 this month/)).toBeVisible();
  await expect(page.getByText('Calculated from your Monetra records by the built-in rules engine.')).toBeVisible();
});

test('creates a savings goal and contributes to it', async ({ page }) => {
  await signUpAndOnboard(page);
  await page.goto('/goals');
  await page.getByRole('button', { name: 'New goal' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Goal name').fill('Emergency fund');
  await dialog.getByLabel('Target amount (₹)').fill('100000');
  await dialog.getByLabel('Already saved (₹) (optional)').fill('25000');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('25%').first().or(page.getByText('of ₹1,00,000.00'))).toBeVisible();
  await page.getByRole('button', { name: 'Add money' }).click();
  await page.getByRole('dialog').getByLabel('Amount (₹)').fill('25000');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('₹50,000.00').first()).toBeVisible();
});
