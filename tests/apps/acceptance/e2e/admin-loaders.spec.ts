import { expect, test } from '@playwright/test';
import { openSettings, signIn } from './editor-session';

test('plugin page loaders stay lazy and avoid native deprecation warnings', async ({ page }) => {
  const warnings: string[] = [];
  const chunks: string[] = [];
  page.on('console', (message) => {
    const text = message.text();
    if (
      message.type() === 'warning' &&
      /addSettingsLink|addMenuLink/.test(text) &&
      /General Translation|Job history/.test(text)
    )
      warnings.push(text);
  });
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (/\/admin\/(SettingsPage|JobsPage)-[^/]+\.js$/.test(path)) chunks.push(path);
  });
  await signIn(page);
  expect(chunks).toEqual([]);
  await openSettings(page);
  expect(chunks.some((path) => path.includes('/SettingsPage-'))).toBe(true);
  expect(chunks.some((path) => path.includes('/JobsPage-'))).toBe(false);
  await page.getByRole('link', { name: 'Job history', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Job history', exact: true })).toBeVisible();
  expect(chunks.some((path) => path.includes('/JobsPage-'))).toBe(true);
  expect(warnings).toEqual([]);
});
