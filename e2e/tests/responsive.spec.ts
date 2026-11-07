import { expect, test } from '@playwright/test';
import { signUpAndOnboard } from './helpers';

test('navigates with the mobile menu', async ({ page }) => {
  await signUpAndOnboard(page);
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('link', { name: 'Transactions' }).click();
  await expect(page).toHaveURL(/\/transactions/);
  await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();
});
