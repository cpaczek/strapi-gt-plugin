import { expect, test, type Page } from '@playwright/test';
import {
  adminOrigin,
  ensureEditorTourHandler,
  openDocument,
  signIn,
  sourceTitle,
} from './editor-session';

test.use({ actionTimeout: 5000 });
const tour =
  '<section id="tour"><p>Step 1 of 4</p><button type="button" onclick="document.body.dataset.skipped = \'true\'; this.parentElement.remove()">Skip</button></section>';
const login =
  '<label>Email<input type="email"></label><label>Password<input type="password"></label><button type="button" onclick="document.body.innerHTML = \'<a href=&quot;/admin/content-manager&quot;>Content Manager</a>\'">Log in</button>';
const installPages = async (
  page: Page,
  options: { visible?: boolean; unrelatedSkip?: boolean; loginTour?: boolean } = {}
) => {
  await page.route(`${adminOrigin}/admin**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    const body =
      path === '/admin'
        ? `${login}${options.loginTour ? tour : ''}`
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

for (const marker of ['Step 1 of 40', 'Step 10 of 4', 'Completed Step 1 of 4']) {
  test(`a near-match tour marker does not dismiss an unrelated action: ${marker}`, async ({
    page,
  }) => {
    await installPages(page, { unrelatedSkip: true });
    await openDocument(page, { documentId: 'near-match' });
    await page.evaluate((text) => {
      const paragraph = document.createElement('p');
      paragraph.textContent = text;
      document.body.append(paragraph);
    }, marker);
    await page.getByRole('textbox', { name: 'title' }).fill('Edited');
    expect(await page.getByRole('button', { name: 'Skip', exact: true }).count()).toBe(1);
  });
}
for (const concurrent of [false, true]) {
  test(`setup callers share one tour registration when concurrent=${concurrent}`, async ({
    page,
  }) => {
    await installPages(page, { visible: true });
    const original = page.addLocatorHandler.bind(page);
    let registrations = 0;
    page.addLocatorHandler = (...parameters) => {
      registrations += 1;
      return original(...parameters);
    };
    if (concurrent)
      await Promise.all([ensureEditorTourHandler(page), ensureEditorTourHandler(page)]);
    else {
      await ensureEditorTourHandler(page);
      await ensureEditorTourHandler(page);
    }
    await openDocument(page, { documentId: 'shared-handler' });
    expect(registrations).toBe(1);
    expect(await page.getByText('Step 1 of 4', { exact: true }).count()).toBe(0);
  });
}
test('a late tour is dismissed before the next self-contained editor action', async ({ page }) => {
  await installPages(page);
  await openDocument(page, { documentId: 'late-tour' });
  await page.evaluate((markup) => document.body.insertAdjacentHTML('beforeend', markup), tour);
  await page.getByRole('textbox', { name: 'title' }).fill('Edited after loading');
  await expect(page.getByRole('textbox', { name: 'title' })).toHaveValue('Edited after loading');
  expect(await page.getByText('Step 1 of 4', { exact: true }).count()).toBe(0);
});
test('the same owner handles a tour that appears again after navigation', async ({ page }) => {
  await installPages(page, { visible: true });
  await signIn(page, fixtureAccount);
  await openDocument(page, { documentId: 'first-document' });
  await openDocument(page, { documentId: 'second-document' });
  expect(await page.locator('body').getAttribute('data-skipped')).toBe('true');
});
test('tour ownership is independent for each browser page', async ({ page, context }) => {
  const second = await context.newPage();
  try {
    for (const current of [page, second]) {
      await installPages(current, { visible: true });
      await openDocument(current, { documentId: 'independent-page' });
      expect(await current.getByText('Step 1 of 4', { exact: true }).count()).toBe(0);
    }
  } finally {
    await second.close();
  }
});
test('a hidden tour marker does not trigger dismissal', async ({ page }) => {
  await installPages(page, { unrelatedSkip: true });
  await openDocument(page, { documentId: 'hidden-tour' });
  await page.evaluate(() =>
    document.body.insertAdjacentHTML('beforeend', '<p hidden>Step 1 of 4</p>')
  );
  await page.getByRole('textbox', { name: 'title' }).fill('Edited');
  expect(await page.getByRole('button', { name: 'Skip', exact: true }).count()).toBe(1);
});
test('one owner handles a visible login tour and a later editor tour', async ({ page }) => {
  await installPages(page, { loginTour: true, visible: true });
  await signIn(page, fixtureAccount);
  await openDocument(page, { documentId: 'login-and-editor' });
  expect(await page.locator('body').getAttribute('data-skipped')).toBe('true');
});
