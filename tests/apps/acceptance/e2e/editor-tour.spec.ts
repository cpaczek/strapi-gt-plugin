import { expect, test, type Page } from '@playwright/test';
import { adminOrigin, openDocument, signIn, sourceTitle } from './editor-session';

test.use({ actionTimeout: 5000 });
const tour =
  '<section id="tour"><p>Step 1 of 4</p><button type="button" onclick="document.body.dataset.skipped = \'true\'; this.parentElement.remove()">Skip</button></section>';
const login =
  '<label>Email<input type="email"></label><label>Password<input type="password"></label><button type="button" onclick="document.body.innerHTML = \'<a href=&quot;/admin/content-manager&quot;>Content Manager</a>\'">Log in</button>';
const installPages = async (
  page: Page,
  options: { visible?: boolean; unrelatedSkip?: boolean } = {}
) => {
  await page.route(`${adminOrigin}/admin**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    const body =
      path === '/admin'
        ? login
        : `<main><label>title<input value="${sourceTitle}"></label>${options.visible ? tour : ''}${options.unrelatedSkip ? '<button type="button" onclick="this.remove()">Skip</button>' : ''}</main>`;
    return route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="en"><head><link rel="icon" href="data:,"></head><body>${body}</body></html>`,
    });
  });
};
const fixtureAccount = { email: 'tour@example.invalid', password: 'Fixture password 1!' };

test('a visible editor tour is dismissed once without intercepting its own Skip action', async ({
  page,
}) => {
  await installPages(page, { visible: true });
  await signIn(page, fixtureAccount);
  await openDocument(page, { documentId: 'tour-document' });
  await expect(page.getByRole('textbox', { name: 'title' })).toBeVisible();
  expect(await page.getByText('Step 1 of 4', { exact: true }).count()).toBe(0);
  expect(await page.locator('body').getAttribute('data-skipped')).toBe('true');
});

test('an already-dismissed editor tour does not block document navigation', async ({ page }) => {
  await installPages(page);
  await signIn(page, fixtureAccount);
  expect(await openDocument(page, { documentId: 'tour-document' })).toBe('tour-document');
  expect(await page.locator('body').getAttribute('data-skipped')).toBeNull();
});

test('an unrelated Skip button is not treated as an editor tour', async ({ page }) => {
  await installPages(page, { unrelatedSkip: true });
  await signIn(page, fixtureAccount);
  await openDocument(page, { documentId: 'tour-document' });
  expect(await page.getByRole('button', { name: 'Skip', exact: true }).count()).toBe(1);
});

test('document navigation owns tour setup when a session was restored without sign-in', async ({
  page,
}) => {
  await installPages(page, { visible: true });
  await openDocument(page, { documentId: 'restored-document' });
  expect(await page.getByText('Step 1 of 4', { exact: true }).count()).toBe(0);
});
