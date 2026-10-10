import { assertAccessible } from './accessibility';
import { expect, test, type Page } from '@playwright/test';
import {
  adminOrigin,
  configureTranslation,
  openDocument,
  openSettings,
  saveSettings,
  signIn,
  sourceTitle,
} from './editor-session';

const translateFrench = async (page: Page): Promise<void> => {
  await page.getByRole('button', { name: 'Translate', exact: true }).first().click();
  const modal = page.getByRole('dialog', { name: 'Translate content' });
  await modal.getByLabel('French (fr)').check();
  await modal.getByLabel('Arabic (ar)').uncheck();
  await modal.getByRole('button', { name: 'Translate', exact: true }).click();
  await expect(page.getByText('Succeeded', { exact: true })).toBeVisible();
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
  const editorUrl = new URL(page.url());
  await translateFrench(page);
  await assertAccessible(page);
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
  await reader.getByRole('link', { name: 'English', exact: true }).click();
  await expect(reader).toHaveURL(new RegExp(`/en/articles/${documentId}$`));
  await expect(reader.getByRole('heading', { name: sourceTitle, exact: true })).toBeVisible();
  await assertAccessible(reader);
  await reader.close();

  await page.goto(`${adminOrigin}/admin/plugins/general-translation`);
  await expect(page.getByRole('heading', { name: 'Job history', exact: true })).toBeVisible();
  await expect(page.getByText('Succeeded', { exact: true }).first()).toBeVisible();
  await assertAccessible(page);
  await page.screenshot({ path: '../../../.work/screenshots/plugin-history.png', fullPage: true });
});
