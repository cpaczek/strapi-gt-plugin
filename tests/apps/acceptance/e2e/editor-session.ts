import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, type Page } from '@playwright/test';
import { z } from 'zod';

export const sourceTitle = 'The custody hearing of Dirt Block 47';
const origin = new URL(process.env.ADMIN_URL ?? 'http://127.0.0.1:1337');
if (
  origin.protocol !== 'http:' ||
  !['127.0.0.1', 'localhost'].includes(origin.hostname) ||
  origin.username ||
  origin.password
)
  throw new TypeError('Editor acceptance requires a loopback HTTP origin without credentials');
export const adminOrigin = origin.origin;
export interface TestAccount {
  email: string;
  password: string;
}
export const readTestAccount = async (): Promise<TestAccount> => {
  const account = z
    .object({ adminEmail: z.string(), adminPassword: z.string() })
    .parse(
      JSON.parse(
        await readFile(resolve(import.meta.dirname, '../../../../.work/testbed/local.json'), 'utf8')
      )
    );
  return { email: account.adminEmail, password: account.adminPassword };
};
export const signIn = async (page: Page, supplied?: TestAccount): Promise<void> => {
  const account = supplied ?? (await readTestAccount());
  await page.goto(`${adminOrigin}/admin`);
  await expect(page.getByLabel(/^Email/i)).toBeVisible();
  if (await page.getByLabel(/^First name/i).isVisible()) {
    await page.getByLabel(/^First name/i).fill('Norb');
    await page.getByLabel(/^Last name/i).fill('Blockkeeper');
    await page.getByLabel(/^Email/i).fill(account.email);
    await page.getByLabel(/^Password/i).fill(account.password);
    await page.getByLabel(/^Confirm password/i).fill(account.password);
    await page.getByRole('button', { name: /let.s start|create account/i }).click();
  } else {
    await page.getByLabel(/^Email/i).fill(account.email);
    await page.getByLabel(/^Password/i).fill(account.password);
    await page.getByRole('button', { name: /^log\s?in$/i }).click();
  }
  await expect(page.getByRole('link', { name: /Content Manager/i })).toBeVisible();
};
export const openSettings = async (page: Page): Promise<void> => {
  await page.goto(`${adminOrigin}/admin/settings/general-translation`);
  await expect(
    page.getByRole('heading', { name: 'General Translation', exact: true })
  ).toBeVisible();
  await expect(page.getByLabel('Project ID')).toBeVisible();
};
export const saveSettings = async (page: Page): Promise<void> => {
  const saved = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.endsWith('/general-translation/settings') &&
      response.request().method() === 'PUT'
  );
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  expect((await saved).status()).toBe(200);
};
export interface TranslationSetup {
  mediaMetadata?: boolean;
  createMissingLocales?: boolean;
  autoPublish?: boolean;
  automaticMode?: 'off' | 'save' | 'publish';
}
export const configureTranslation = async (
  page: Page,
  options: TranslationSetup = {}
): Promise<void> => {
  await openSettings(page);
  if (options.mediaMetadata !== undefined)
    await page
      .getByLabel('Translate media alt text and captions for api::article.article')
      .setChecked(options.mediaMetadata);
  if (options.createMissingLocales !== undefined)
    await page.getByLabel('Create missing target locales').setChecked(options.createMissingLocales);
  if (options.autoPublish !== undefined)
    await page.getByLabel('Publish translations automatically').setChecked(options.autoPublish);
  if (options.automaticMode !== undefined) {
    const labels = { off: 'Off', save: 'On source save', publish: 'On source publish' };
    await page.getByRole('combobox', { name: 'Automatic translation', exact: true }).click();
    await page.getByRole('option', { name: labels[options.automaticMode], exact: true }).click();
  }
  await saveSettings(page);
};
export interface DocumentLocation {
  documentId?: string;
  locale?: string;
  title?: string;
}
export const openDocument = async (page: Page, options: DocumentLocation = {}): Promise<string> => {
  const collection = `${adminOrigin}/admin/content-manager/collection-types/api::article.article`;
  const locale = options.locale ?? 'en';
  if (options.documentId)
    await page.goto(
      `${collection}/${encodeURIComponent(options.documentId)}?locale=${encodeURIComponent(locale)}`
    );
  else {
    await page.goto(`${collection}?locale=${encodeURIComponent(locale)}`);
    await page.getByText(options.title ?? sourceTitle, { exact: true }).click();
  }
  await expect(page).toHaveURL(/\/collection-types\/api::article\.article\/[^/?]+/);
  await expect(page.getByRole('textbox', { name: /^title\*?$/i }).first()).toBeVisible();
  const documentId = new URL(page.url()).pathname.split('/').at(-1);
  if (!documentId) throw new Error('Editor did not open a saved document');
  return documentId;
};
