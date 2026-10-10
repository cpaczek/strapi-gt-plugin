import { assertAccessible } from './accessibility';
import { expect, test } from '@playwright/test';

test('the Latin masthead keeps its order on LTR and RTL pages', async ({ page }) => {
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    for (const locale of ['en', 'ar']) {
      await page.goto(`/${locale}`);
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
      const positions = await page.locator('.wordmark').evaluate((wordmark) => {
        const prefix = wordmark.firstChild;
        const suffix = wordmark.querySelector('.wordmark-dot');
        if (!(prefix instanceof Text) || !(suffix instanceof HTMLElement))
          throw new Error('The masthead wordmark is missing its text');
        const range = document.createRange();
        range.selectNode(prefix);
        return {
          prefix: range.getBoundingClientRect().left,
          suffix: suffix.getBoundingClientRect().left,
        };
      });
      expect(positions.prefix).toBeLessThan(positions.suffix);
    }
  }
});

test('published edition is accessible and excludes the draft control', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/en');
  await expect(
    page.getByRole('heading', { name: 'The custody hearing of Dirt Block 47' })
  ).toBeVisible();
  await expect(
    page.getByText('UNPUBLISHED: my extremely normal plan to steal the moon')
  ).toHaveCount(0);
  await expect(page.locator('.feature-story img')).toHaveAttribute('loading', 'eager');
  await assertAccessible(page);
  await page.screenshot({ path: '../../../.work/screenshots/reader-viewport.png' });
  await page.screenshot({ path: '../../../.work/screenshots/reader-home.png', fullPage: true });
});

test('article navigation retains identity across language changes', async ({ page }) => {
  await page.goto('/en');
  await page.getByRole('link', { name: 'Read the story' }).first().click();
  await expect(
    page.getByRole('heading', {
      name: 'The custody hearing of Dirt Block 47',
      exact: true,
      level: 1,
    })
  ).toBeVisible();
  await expect(page).toHaveURL(/\/en\/articles\/[^/]+$/);
  await expect(page.locator('.cover img')).toHaveAttribute('loading', 'eager');
  const documentId = new URL(page.url()).pathname.split('/').at(-1);
  await page.getByRole('link', { name: 'العربية', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/ar/articles/${documentId}$`));
  await expect(
    page.getByRole('heading', { name: 'This story is not available in this language.' })
  ).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page).toHaveTitle('Story unavailable | The Ender Post');
  await assertAccessible(page);
});

test('mobile edition has no horizontal overflow and supports keyboard navigation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/en');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Tall tales.*Petty theft/s);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to stories' })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
  await assertAccessible(page);
  await page.getByRole('heading', { level: 1 }).click();
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
  await page.getByLabel('Alleged value').fill('0.5');
  await page.getByLabel('Number style').selectOption('percent');
  await expect(page.getByLabel('Formatted number')).toContainText('50');
  await expect(page.getByLabel('Formatted number')).toContainText('%');
  await page.getByLabel('Number style').selectOption('unit');
  await expect(page.getByLabel('Formatted number')).toContainText('mètre');
  await page.getByLabel('Alleged value').fill('12500');
  await page.getByLabel('Number style').selectOption('compact');
  await expect(page.getByLabel('Formatted number')).toContainText(/k/i);
  await page.getByLabel('Price and number digits').selectOption('arab');
  await expect(page.getByLabel('Formatted currency')).toContainText('١');
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
  await assertAccessible(page);
});

test('an unknown document is a real 404', async ({ page }) => {
  const response = await page.goto('/en/articles/never-saved-document');
  expect(response?.status()).toBe(404);
});
