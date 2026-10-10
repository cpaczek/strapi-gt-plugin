import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('published edition is accessible and excludes the draft control', async ({ page }) => {
  await page.goto('/en');
  await expect(
    page.getByRole('heading', { name: 'The custody hearing of Dirt Block 47' })
  ).toBeVisible();
  await expect(
    page.getByText('UNPUBLISHED: my extremely normal plan to steal the moon')
  ).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: '../../../.work/screenshots/reader-home.png', fullPage: true });
});

test('article navigation retains identity across language changes', async ({ page }) => {
  await page.goto('/en');
  await page.getByRole('link', { name: 'Read the story' }).first().click();
  await expect(
    page.getByRole('heading', { name: 'The custody hearing of Dirt Block 47', exact: true })
  ).toBeVisible();
  const documentId = new URL(page.url()).pathname.split('/').at(-1);
  await page.getByRole('link', { name: 'Français', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/fr/articles/${documentId}$`));
  await expect(
    page.getByRole('heading', { name: 'This story is not available in this language.' })
  ).toBeVisible();
  await page.getByRole('link', { name: 'العربية', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('mobile edition has no horizontal overflow and supports keyboard navigation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/en');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to stories' })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: '../../../.work/screenshots/reader-mobile.png', fullPage: true });
});

test('GT playground changes real local formatters and marks sample conversion', async ({
  page,
}) => {
  const externalRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('api.gtx.dev')) externalRequests.push(request.url());
  });
  await page.goto('/en');
  await page.getByLabel('Formatting language').selectOption('fr');
  await expect(page.getByLabel('Formatted currency')).toContainText('1');
  await page.getByLabel('Blocks in custody').fill('0');
  await expect(page.getByLabel('Custody report')).toContainText('No blocks');
  await page.getByLabel('Witness mood').selectOption('furious');
  await expect(page.getByLabel('Custody report')).toContainText('stare crime');
  await page.getByLabel('Formatting language').selectOption('ar');
  await expect(page.locator('.lab-results')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByText('No exchange-rate conversion.', { exact: false })).toBeVisible();
  await page.getByLabel('Sample EUR per USD').fill('1');
  await expect(page.getByLabel('Sample conversion')).toBeVisible();
  expect(externalRequests).toEqual([]);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
