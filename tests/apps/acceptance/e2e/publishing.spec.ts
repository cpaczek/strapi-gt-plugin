import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { z } from 'zod';

const sourceTitle = 'The custody hearing of Dirt Block 47';
const credentials = async () =>
  z
    .object({ adminEmail: z.string(), adminPassword: z.string() })
    .parse(
      JSON.parse(
        await readFile(resolve(import.meta.dirname, '../../../../.work/testbed/local.json'), 'utf8')
      )
    );
const signIn = async (page: Page): Promise<void> => {
  const account = await credentials();
  await page.goto('http://127.0.0.1:1337/admin');
  await expect(page.getByLabel(/^Email/i)).toBeVisible();
  if (await page.getByLabel(/^First name/i).isVisible()) {
    await page.getByLabel(/^First name/i).fill('Norb');
    await page.getByLabel(/^Last name/i).fill('Blockkeeper');
    await page.getByLabel(/^Email/i).fill(account.adminEmail);
    await page.getByLabel(/^Password$/i).fill(account.adminPassword);
    await page.getByLabel(/^Confirm password/i).fill(account.adminPassword);
    await page.getByRole('button', { name: /let.s start|create account/i }).click();
  } else {
    await page.getByLabel(/^Email/i).fill(account.adminEmail);
    await page.getByLabel(/^Password$/i).fill(account.adminPassword);
    await page.getByRole('button', { name: /^login$/i }).click();
  }
  await expect(page.getByRole('link', { name: /Content Manager/i })).toBeVisible();
};
const translateFrench = async (page: Page): Promise<void> => {
  await page.getByRole('button', { name: 'Translate', exact: true }).first().click();
  const modal = page.getByRole('dialog', { name: 'Translate content' });
  await modal.getByLabel('French (fr)').check();
  await modal.getByLabel('Arabic (ar)').uncheck();
  await modal.getByRole('button', { name: 'Translate', exact: true }).click();
  await expect(page.getByText('Succeeded', { exact: true })).toBeVisible();
};

test('editor translation stays a draft until publication and reaches the reader', async ({
  page,
  context,
}) => {
  await signIn(page);
  await page.goto('http://127.0.0.1:1337/admin/settings/general-translation');
  await expect(
    page.getByRole('heading', { name: 'General Translation', exact: true })
  ).toBeVisible();
  await expect(page.getByLabel('Project ID')).toHaveValue('editorial');
  await page.getByRole('button', { name: 'Test connection', exact: true }).click();
  await expect(page.getByText(/Connected to your GT project/)).toBeVisible();
  await page.getByLabel('Translate media alt text and captions for api::article.article').check();
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/general-translation/settings') &&
      response.request().method() === 'PUT'
  );
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  expect((await saved).status()).toBe(200);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: '../../../.work/screenshots/plugin-settings.png', fullPage: true });

  await page.goto(
    'http://127.0.0.1:1337/admin/content-manager/collection-types/api::article.article?locale=en'
  );
  await page.getByText(sourceTitle, { exact: true }).click();
  await expect(page.getByRole('textbox', { name: /^title$/i })).toHaveValue(sourceTitle);
  const editorUrl = new URL(page.url());
  const documentId = editorUrl.pathname.split('/').at(-1);
  if (!documentId) throw new Error('Editor did not navigate to a saved document');
  await translateFrench(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: '../../../.work/screenshots/plugin-translation-panel.png',
    fullPage: true,
  });

  const reader = await context.newPage();
  await reader.goto(`/fr/articles/${documentId}`);
  await expect(
    reader.getByRole('heading', { name: 'This story is not available in this language.' })
  ).toBeVisible();
  editorUrl.searchParams.set('locale', 'fr');
  await page.goto(editorUrl.href);
  await expect(page.getByRole('textbox', { name: /^title$/i })).toHaveValue(`[fr] ${sourceTitle}`);
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect
    .poll(async () => {
      await reader.reload();
      return reader.getByRole('heading', { name: `[fr] ${sourceTitle}`, exact: true }).count();
    })
    .toBe(1);
  await expect(
    reader.getByRole('img', { name: /^\[fr\] Original pixel drawing/ }).first()
  ).toBeVisible();
  await reader.getByRole('link', { name: 'English', exact: true }).click();
  await expect(reader).toHaveURL(new RegExp(`/en/articles/${documentId}$`));
  await expect(reader.getByRole('heading', { name: sourceTitle, exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page: reader }).analyze()).violations).toEqual([]);
  await reader.close();

  await page.goto('http://127.0.0.1:1337/admin/plugins/general-translation');
  await expect(page.getByRole('heading', { name: 'Job history', exact: true })).toBeVisible();
  await expect(page.getByText('Succeeded', { exact: true }).first()).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: '../../../.work/screenshots/plugin-history.png', fullPage: true });
});
