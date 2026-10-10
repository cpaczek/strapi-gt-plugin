import { expect, test } from '@playwright/test';

test('admin boots before authentication without module evaluation errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (failure) => errors.push(failure.message));
  await page.goto('http://127.0.0.1:1337/admin');
  await expect(page.getByLabel(/^Email/i)).toBeVisible();
  expect(errors).toEqual([]);
});
