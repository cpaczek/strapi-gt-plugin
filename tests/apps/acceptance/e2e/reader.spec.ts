import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('published edition is accessible and excludes the draft control', async ({ page }) => {
  await page.goto('/en');
  await expect(page.getByRole('heading', { name: 'Where the tide leaves a story' })).toBeVisible();
  await expect(page.getByText('The unpublished lighthouse notebook')).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: '../../../.work/screenshots/reader-home.png', fullPage: true });
});

test('article navigation retains identity across language changes', async ({ page }) => {
  await page.goto('/en');
  await page.getByRole('link', { name: 'Read the story' }).click();
  await expect(
    page.getByRole('heading', { name: 'Where the tide leaves a story', exact: true })
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
