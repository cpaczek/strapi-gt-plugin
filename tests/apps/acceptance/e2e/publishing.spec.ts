import { ACCEPTANCE_JOB_TIMEOUT_MS } from '../../../../packages/plugin/shared/constants';
import { assertAccessible } from './accessibility';
import { expect, test, type Page } from '@playwright/test';
import {
  adminOrigin,
  configureTranslation,
  openDocument,
  openSettings,
  openTranslation,
  saveSettings,
  signIn,
  sourceTitle,
} from './editor-session';

const translateFrench = async (page: Page): Promise<void> => {
  await openTranslation(page);
  const modal = page.getByRole('dialog', { name: 'Translate content' });
  await modal.getByLabel('French (fr)').check();
  await modal.getByLabel('Arabic (ar)').uncheck();
  await assertAccessible(page, '[role="dialog"]');
  await modal.getByRole('button', { name: 'Translate', exact: true }).click();
  await expect(page.getByText('Succeeded', { exact: true })).toBeVisible({
    timeout: ACCEPTANCE_JOB_TIMEOUT_MS,
  });
  await page.screenshot({ path: '../../../.work/screenshots/plugin-translation-dialog.png' });
  await modal.getByRole('button', { name: 'Close modal', exact: true }).click();
  await expect(modal).not.toBeVisible();
};

test('settings connect to GT and meet accessibility requirements', async ({ page }) => {
  await signIn(page);
  await openSettings(page);
  await expect(page.getByLabel('Project ID')).toHaveValue('editorial');
  await page.getByRole('button', { name: 'Test connection', exact: true }).click();
  await expect(page.getByText(/Connected to your GT project/)).toBeVisible();
  await page.getByLabel('Translate media alt text and captions for api::article.article').check();
  await saveSettings(page);
  await assertAccessible(page);
  await page.screenshot({ path: '../../../.work/screenshots/plugin-settings.png', fullPage: true });
  await page
    .getByRole('heading', { name: 'General Translation', exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: '../../../.work/screenshots/plugin-settings-viewport.png' });
});

test('editor translation stays a draft until publication and reaches the reader', async ({
  page,
  context,
}) => {
  await signIn(page);
  await configureTranslation(page, {
    mediaMetadata: true,
    createMissingLocales: true,
    autoPublish: false,
    automaticMode: 'off',
  });
  const documentId = await openDocument(page);
  await translateFrench(page);
  await assertAccessible(page, 'section[aria-label="General Translation controls"]');
  await page.screenshot({
    path: '../../../.work/screenshots/plugin-translation-panel.png',
    fullPage: true,
  });

  const reader = await context.newPage();
  await reader.goto(`/fr/articles/${documentId}`);
  await expect(
    reader.getByRole('heading', { name: 'This story is not available in this language.' })
  ).toBeVisible();
  await openDocument(page, { documentId, locale: 'fr' });
  await expect(page.getByRole('textbox', { name: /^title\*?$/i }).first()).toHaveValue(
    `[fr] ${sourceTitle}`
  );
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
  await reader.screenshot({ path: '../../../.work/screenshots/reader-published-fr.png' });
  await reader.getByRole('link', { name: 'English', exact: true }).click();
  await expect(reader).toHaveURL(new RegExp(`/en/articles/${documentId}$`));
  await expect(reader.getByRole('heading', { name: sourceTitle, exact: true })).toBeVisible();
  await assertAccessible(reader);
  await reader.close();
  await assertAccessible(page, 'section[aria-label="General Translation controls"]');

  await page.goto(`${adminOrigin}/admin/plugins/general-translation`);
  await expect(page.getByRole('heading', { name: 'Job history', exact: true })).toBeVisible();
  await expect(page.getByText('Succeeded', { exact: true }).first()).toBeVisible();
  await assertAccessible(page);
  await page.screenshot({ path: '../../../.work/screenshots/plugin-history.png', fullPage: true });
});
