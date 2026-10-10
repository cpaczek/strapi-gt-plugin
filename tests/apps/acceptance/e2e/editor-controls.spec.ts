import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  expect,
  request,
  test as base,
  type APIRequestContext,
  type BrowserContext,
  type Page,
  type Locator,
} from '@playwright/test';
import { z } from 'zod';
import { messages } from '../../../../packages/plugin/shared/messages';
import { jobsSchema, enqueueSchema } from '../../../../packages/plugin/admin/src/api';
import { assertAccessible } from './accessibility';
import {
  adminOrigin,
  configureTranslation,
  openDocument,
  openTranslation,
  dismissEditorTour,
  openSettings,
  signIn,
  type TestAccount,
} from './editor-session';

const model = 'api::article.article';
const collection = `/content-manager/collection-types/${model}`;
const identified = z.object({ data: z.object({ id: z.number() }) });
const documentResponse = z.object({
  data: z.object({ documentId: z.string(), title: z.string() }),
});
interface SourceDocument {
  documentId: string;
  title: string;
}
interface EditorFixture {
  api: APIRequestContext;
  createSource: (prefix: string) => Promise<SourceDocument>;
  createAccount: (canTranslate: boolean) => Promise<TestAccount>;
}
const authenticatedApi = async (page: Page, account?: TestAccount): Promise<APIRequestContext> => {
  const [login] = await Promise.all([
    page.waitForResponse(
      (response) =>
        /\/admin\/(login|register-admin)$/.test(new URL(response.url()).pathname) &&
        response.request().method() === 'POST'
    ),
    signIn(page, account),
  ]);
  const credentials = z
    .object({ data: z.object({ token: z.string(), user: z.object({ email: z.string() }) }) })
    .parse(await login.json());
  if (account) expect(credentials.data.user.email).toBe(account.email);
  return request.newContext({
    baseURL: adminOrigin,
    storageState: { cookies: [], origins: [] },
    extraHTTPHeaders: { Authorization: `Bearer ${credentials.data.token}` },
  });
};
interface AdminSession {
  api: APIRequestContext;
  storage: Awaited<ReturnType<BrowserContext['storageState']>>;
}
const test = base.extend<{ editor: EditorFixture }, { adminSession: AdminSession }>({
  adminSession: [
    async ({ browser }, use) => {
      const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
      const page = await context.newPage();
      const api = await authenticatedApi(page);
      try {
        const storage = await context.storageState();
        // The API session is independent; leave only the actual editor tab open.
        await context.close();
        await use({ api, storage });
      } finally {
        await api.dispose();
        await context.close();
      }
    },
    { scope: 'worker' },
  ],
  storageState: async ({ adminSession }, use) => {
    await use(adminSession.storage);
  },
  editor: async ({ page, adminSession }, use) => {
    await page.bringToFront();
    await page.addLocatorHandler(
      page.getByText('Step 1 of 4', { exact: true }),
      () => dismissEditorTour(page),
      { times: 1 }
    );
    const api = adminSession.api;
    const originalResponse = await api.get('/general-translation/settings');
    expect(originalResponse.status()).toBe(200);
    const original = z
      .object({ settings: z.unknown() })
      .parse(await originalResponse.json()).settings;
    const owned: { documents: string[]; users: number[]; roles: number[] } = {
      documents: [],
      users: [],
      roles: [],
    };
    await configureTranslation(page, {
      automaticMode: 'off',
      autoPublish: false,
      createMissingLocales: true,
      mediaMetadata: false,
    });
    try {
      await use({
        api,
        async createSource(prefix) {
          const identifier = randomUUID();
          const title = `${prefix} ${identifier}`;
          const response = await api.post(`${collection}?locale=en`, {
            data: { title, slug: identifier, summary: 'A field note for translation acceptance.' },
          });
          expect(response.status()).toBe(201);
          const source = documentResponse.parse(await response.json()).data;
          owned.documents.push(source.documentId);
          return source;
        },
        async createAccount(canTranslate) {
          const identifier = randomUUID();
          const roleResponse = await api.post('/admin/roles', {
            data: {
              name: `Browser editor ${identifier}`,
              description: 'Isolated browser acceptance role',
            },
          });
          expect(roleResponse.status()).toBe(201);
          const role = identified.parse(await roleResponse.json()).data.id;
          owned.roles.push(role);
          const actions = canTranslate ? ['read', 'create', 'update'] : ['read'];
          const permissions = actions.map((action) => ({
            action: `plugin::content-manager.explorer.${action}`,
            subject: model,
            properties: { fields: ['title', 'slug', 'summary'], locales: ['en', 'fr', 'ar'] },
            conditions: [],
          }));
          const permissionResponse = await api.put(`/admin/roles/${role}/permissions`, {
            data: {
              permissions: [
                ...permissions,
                ...(canTranslate
                  ? [
                      {
                        action: 'plugin::general-translation.translate',
                        subject: null,
                        properties: {},
                        conditions: [],
                      },
                    ]
                  : []),
              ],
            },
          });
          expect(permissionResponse.status()).toBe(200);
          const account = {
            email: `editor-${identifier}@example.invalid`,
            password: `${randomBytes(16).toString('hex')}Aa1!`,
          };
          const userResponse = await api.post('/admin/users', {
            data: {
              firstname: 'Acceptance',
              lastname: 'Editor',
              email: account.email,
              roles: [role],
            },
          });
          expect(userResponse.status()).toBe(201);
          const user = identified.parse(await userResponse.json()).data.id;
          owned.users.push(user);
          const activated = await api.put(`/admin/users/${user}`, {
            data: { password: account.password, isActive: true },
          });
          expect(activated.status()).toBe(200);
          return account;
        },
      });
    } finally {
      const restored = await api.put('/general-translation/settings', { data: original });
      expect(restored.status()).toBe(200);
      for (const documentId of owned.documents) {
        for (const locale of ['fr', 'ar', 'en']) {
          const removed = await api.delete(`${collection}/${documentId}?locale=${locale}`);
          expect([200, 404]).toContain(removed.status());
        }
      }
      for (const user of owned.users)
        expect((await api.delete(`/admin/users/${user}`)).status()).toBe(200);
      for (const role of owned.roles)
        expect((await api.delete(`/admin/roles/${role}`)).status()).toBe(200);
    }
  },
});
const waitForJobs = async (api: APIRequestContext, documentIds: string[], jobIds?: number[]) => {
  await expect
    .poll(
      async () => {
        const response = await api.get('/general-translation/jobs');
        expect(response.status()).toBe(200);
        const jobs = jobsSchema
          .parse(await response.json())
          .jobs.filter(
            (job) => documentIds.includes(job.documentId) && (!jobIds || jobIds.includes(job.id))
          );
        return (
          jobs.length >= (jobIds?.length ?? documentIds.length) &&
          jobs.every((job) => ['succeeded', 'conflict'].includes(job.status))
        );
      },
      { timeout: 60_000 }
    )
    .toBe(true);
};
const enabledContrast = (button: Locator): Promise<number> =>
  button.evaluate(
    (element) =>
      new Promise<number>((resolve) => {
        const luminance = (color: string) => {
          const [red = 0, green = 0, blue = 0] = (color.match(/[\d.]+/g) ?? [])
            .slice(0, 3)
            .map((channel) => {
              const value = Number(channel) / 255;
              return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
            });
          return red * 0.2126 + green * 0.7152 + blue * 0.0722;
        };
        let wasDisabled = false;
        const observer = new MutationObserver((records) => {
          if (
            records.some((record) => record.oldValue === 'true') ||
            element.getAttribute('aria-disabled') === 'true'
          )
            wasDisabled = true;
          if (wasDisabled && element.getAttribute('aria-disabled') !== 'true') {
            observer.disconnect();
            let minimum = Infinity;
            const sample = () => {
              const foreground = luminance(getComputedStyle(element).color);
              const background = luminance(getComputedStyle(element).backgroundColor);
              minimum = Math.min(
                minimum,
                (Math.max(foreground, background) + 0.05) /
                  (Math.min(foreground, background) + 0.05)
              );
              if (element.getAnimations().some((animation) => animation.playState === 'running'))
                requestAnimationFrame(sample);
              else resolve(minimum);
            };
            sample();
          }
        });
        observer.observe(element, {
          attributes: true,
          attributeFilter: ['aria-disabled'],
          attributeOldValue: true,
        });
      })
  );

const queueFrench = async (page: Page, force = false) => {
  await openTranslation(page);
  const modal = page.getByRole('dialog', { name: 'Translate content' });
  await modal.getByRole('checkbox', { name: 'French (fr)', exact: true }).check();
  await modal.getByRole('checkbox', { name: 'Arabic (ar)', exact: true }).uncheck();
  if (force) {
    await modal.getByRole('checkbox', { name: 'Force retranslate', exact: true }).check();
    await expect(
      modal.getByRole('button', { name: 'Force retranslate', exact: true })
    ).toBeDisabled();
    await modal
      .getByRole('checkbox', {
        name: 'I reviewed the target content and accept replacing human edits',
        exact: true,
      })
      .check();
  }
  const queued = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/general-translation/translate' &&
      response.request().method() === 'POST'
  );
  const submit = modal.getByRole('button', {
    name: force ? 'Force retranslate' : 'Translate',
    exact: true,
  });
  const contrast = enabledContrast(submit);
  await submit.click();
  const response = await queued;
  expect(response.status()).toBe(200);
  await expect(modal.getByText(/Translation jobs were queued/)).toBeVisible();
  const jobs = enqueueSchema.parse(await response.json()).jobs;
  expect(await contrast).toBeGreaterThanOrEqual(4.5);
  await assertAccessible(page, '[role="dialog"]');
  await modal.getByRole('button', { name: 'Close modal', exact: true }).click();
  await assertAccessible(page, 'section[aria-label="General Translation controls"]');
  return jobs.map((job) => job.id);
};
const saveDocument = async (page: Page) => {
  const saved = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.startsWith(collection) &&
      response.request().method() === 'PUT'
  );
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  expect((await saved).status()).toBe(200);
};

test('bulk translation queues only the selected saved documents', async ({ page, editor }) => {
  const first = await editor.createSource('Bulk first');
  const second = await editor.createSource('Bulk second');
  const unselected = await editor.createSource('Unselected control');
  let releaseOptions = () => {};
  const optionsGate = new Promise<void>((resolve) => {
    releaseOptions = resolve;
  });
  await page.route(
    '**/general-translation/translation-options',
    async (route) => {
      const response = await route.fetch();
      await optionsGate;
      await route.fulfill({ response });
    },
    { times: 1 }
  );
  const optionsLoaded = page.waitForResponse('**/general-translation/translation-options');
  await page.goto(`${adminOrigin}/admin${collection}?locale=en`);
  await expect(page.getByRole('grid')).toBeVisible();
  await dismissEditorTour(page);
  for (const source of [first, second]) {
    const row = page
      .getByRole('row')
      .filter({ has: page.getByText(source.title, { exact: true }) });
    await row.getByRole('checkbox').check();
  }
  await expect(page.getByRole('button', { name: 'Translate selected', exact: true })).toBeVisible();
  for (const source of [second, first]) {
    await page
      .getByRole('row')
      .filter({ has: page.getByText(source.title, { exact: true }) })
      .getByRole('checkbox')
      .uncheck();
  }
  await expect(page.getByRole('button', { name: 'Translate selected', exact: true })).toHaveCount(
    0
  );
  for (const source of [unselected, first]) {
    await page
      .getByRole('row')
      .filter({ has: page.getByText(source.title, { exact: true }) })
      .getByRole('checkbox')
      .check();
  }
  await expect(page.getByRole('button', { name: 'Translate selected', exact: true })).toBeVisible();
  await page
    .getByRole('row')
    .filter({ has: page.getByText(unselected.title, { exact: true }) })
    .getByRole('checkbox')
    .uncheck();
  await page
    .getByRole('row')
    .filter({ has: page.getByText(second.title, { exact: true }) })
    .getByRole('checkbox')
    .check();
  await page.getByRole('button', { name: 'Translate selected', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Translate selected' });
  await expect(modal).toBeVisible();
  releaseOptions();
  expect((await optionsLoaded).status()).toBe(200);
  await modal.getByRole('checkbox', { name: 'Arabic (ar)', exact: true }).uncheck();
  const queued = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/general-translation/bulk' &&
      response.request().method() === 'POST'
  );
  await modal.getByRole('button', { name: 'Translate selected', exact: true }).click();
  const response = await queued;
  expect(response.status()).toBe(200);
  const jobs = enqueueSchema.parse(await response.json()).jobs;
  await expect(modal.getByText(/Translation jobs were queued/)).toBeVisible();
  await assertAccessible(page, '[role="dialog"]');
  expect(jobs.map((job) => job.documentId).sort()).toEqual(
    [first.documentId, second.documentId].sort()
  );
  await waitForJobs(
    editor.api,
    [first.documentId, second.documentId],
    jobs.map((job) => job.id)
  );
  await page.goto(`${adminOrigin}/admin/plugins/general-translation`);
  for (const source of [first, second])
    await expect(
      page
        .getByRole('row')
        .filter({ hasText: source.documentId })
        .getByText('Succeeded', { exact: true })
    ).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: unselected.documentId })).toHaveCount(0);
  await assertAccessible(page);
});

test('human target edits survive normal translation and force requires consent', async ({
  page,
  editor,
}) => {
  const source = await editor.createSource('Human edit control');
  await openDocument(page, source);
  await waitForJobs(editor.api, [source.documentId], await queueFrench(page));
  await openDocument(page, { documentId: source.documentId, locale: 'fr' });
  const humanTitle = `Reviewed by an editor ${randomUUID()}`;
  await page
    .getByRole('textbox', { name: /^title\*?$/i })
    .first()
    .fill(humanTitle);
  await saveDocument(page);
  await openDocument(page, source);
  const revisedTitle = `${source.title} revised`;
  await page
    .getByRole('textbox', { name: /^title\*?$/i })
    .first()
    .fill(revisedTitle);
  await saveDocument(page);
  await waitForJobs(editor.api, [source.documentId], await queueFrench(page));
  await openDocument(page, { documentId: source.documentId, locale: 'fr' });
  await expect(page.getByRole('textbox', { name: /^title\*?$/i }).first()).toHaveValue(humanTitle);
  await page.goto(`${adminOrigin}/admin/me`);
  await page.getByRole('combobox', { name: 'Interface mode' }).click();
  await page.getByRole('option', { name: 'Dark mode', exact: true }).click();
  const profileSaved = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/admin/users/me' &&
      response.request().method() === 'PUT'
  );
  await page.locator('button[type="submit"]').click();
  expect((await profileSaved).status()).toBe(200);
  await openDocument(page, source);
  await waitForJobs(editor.api, [source.documentId], await queueFrench(page, true));
  await openDocument(page, { documentId: source.documentId, locale: 'fr' });
  await expect(page.getByRole('textbox', { name: /^title\*?$/i }).first()).toHaveValue(
    `[fr] ${revisedTitle}`
  );
});

test('source publication can automatically publish the translated locale', async ({
  page,
  editor,
  context,
}) => {
  const source = await editor.createSource('Automatic publication');
  await configureTranslation(page, { automaticMode: 'publish', autoPublish: true });
  await openDocument(page, source);
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  const confirmation = page.getByRole('dialog');
  if (await confirmation.isVisible())
    await confirmation.getByRole('button', { name: /publish/i }).click();
  await waitForJobs(editor.api, [source.documentId]);
  const reader = await context.newPage();
  await reader.goto(`/fr/articles/${source.documentId}`);
  await expect(
    reader.getByRole('heading', { name: `[fr] ${source.title}`, exact: true })
  ).toBeVisible();
  await assertAccessible(reader);
  await reader.close();
});

test('a read-only editor cannot see translation actions or call their endpoints', async ({
  page,
  editor,
  browser,
}) => {
  const source = await editor.createSource('Permission denial');
  const account = await editor.createAccount(false);
  const restricted = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const restrictedPage = await restricted.newPage();
  const restrictedApi = await authenticatedApi(restrictedPage, account);
  try {
    await openDocument(restrictedPage, source);
    const actionMenu = restrictedPage.getByRole('button', {
      name: 'More document actions',
      exact: true,
    });
    if (await actionMenu.isVisible()) {
      await actionMenu.click();
      await expect(
        restrictedPage.getByRole('menuitem', { name: 'Translate', exact: true })
      ).toHaveCount(0);
      await restrictedPage.keyboard.press('Escape');
    }
    await expect(restrictedPage.getByText('Translation', { exact: true })).toHaveCount(0);
    const response = await restrictedApi.post('/general-translation/translate', {
      data: {
        contentType: model,
        documentIds: [source.documentId],
        targetLocales: ['fr'],
        force: false,
      },
    });
    expect(response.status()).toBe(403);
    await restrictedPage.goto(`${adminOrigin}/admin${collection}?locale=en`);
    await expect(restrictedPage.getByRole('grid')).toBeVisible();
    await expect(
      restrictedPage.getByRole('heading', { name: 'Article', exact: true })
    ).toBeVisible();
    const selection = restrictedPage
      .getByRole('row')
      .filter({ hasText: source.title })
      .getByRole('checkbox');
    if (await selection.count()) await selection.check();
    const bulkResponse = await restrictedApi.post('/general-translation/bulk', {
      data: {
        contentType: model,
        documentIds: [source.documentId],
        targetLocales: ['fr'],
        force: false,
      },
    });
    expect(bulkResponse.status()).toBe(403);
    await expect(
      restrictedPage.getByRole('button', { name: 'Translate selected', exact: true })
    ).toHaveCount(0);
  } finally {
    await restrictedApi.dispose();
    await restricted.close();
  }
  await expect(
    page.getByRole('heading', { name: 'General Translation', exact: true })
  ).toBeVisible();
});

test('a translator can use document options without settings access', async ({
  editor,
  browser,
}) => {
  const source = await editor.createSource('Translate-only editor');
  const account = await editor.createAccount(true);
  const restricted = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await restricted.newPage();
  const api = await authenticatedApi(page, account);
  const settingsRequests: string[] = [];
  page.on('request', (outgoing) => {
    if (new URL(outgoing.url()).pathname === '/general-translation/settings')
      settingsRequests.push(outgoing.method());
  });
  try {
    await openDocument(page, source);
    await expect(page.getByRole('button', { name: 'Choose locales', exact: true })).toBeVisible();
    expect(settingsRequests).toEqual([]);
    expect((await api.get('/general-translation/translation-options')).status()).toBe(200);
    expect((await api.get('/general-translation/settings')).status()).toBe(403);
    await waitForJobs(api, [source.documentId], await queueFrench(page));
    await openDocument(page, { documentId: source.documentId, locale: 'fr' });
    await expect(page.getByRole('textbox', { name: /^title\*?$/i }).first()).toHaveValue(
      `[fr] ${source.title}`
    );
  } finally {
    await api.dispose();
    await restricted.close();
  }
});

for (const diagnostic of [
  messages.invalidKey(),
  messages.quotaExhausted(),
  messages.unsupportedLocale('unsupported-fixture'),
  messages.providerFailure('The provider rejected this fixture'),
]) {
  test(`renders the ${diagnostic.code} HTTP failure with an actionable retry`, async ({ page }) => {
    await openSettings(page);
    await page.route('**/general-translation/connection', (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: diagnostic }),
      })
    );
    await page.getByRole('button', { name: 'Test connection', exact: true }).click();
    await expect(page.getByText(diagnostic.text, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Test connection', exact: true })).toBeEnabled();
    await assertAccessible(page);
  });
}
test('renders a network failure without leaking transport details', async ({ page }) => {
  await openSettings(page);
  await page.route('**/general-translation/connection', (route) => route.abort('connectionfailed'));
  await page.getByRole('button', { name: 'Test connection', exact: true }).click();
  await expect(page.getByText(messages.adminRequestFailure().text, { exact: true })).toBeVisible();
  await assertAccessible(page);
});
test('shows real server validation when the project ID exceeds its allowed length', async ({
  page,
  editor,
}) => {
  await openSettings(page);
  await page.getByRole('textbox', { name: 'Project ID' }).fill('x'.repeat(201));
  const response = page.waitForResponse(
    (incoming) =>
      new URL(incoming.url()).pathname === '/general-translation/settings' &&
      incoming.request().method() === 'PUT'
  );
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  expect((await response).status()).toBe(400);
  await expect(page.getByText(/The translation request is not valid/)).toBeVisible();
  expect((await editor.api.get('/general-translation/settings')).status()).toBe(200);
  await assertAccessible(page);
});

test('native profile language selection loads Spanish, French and Arabic plugin labels', async ({
  page,
  editor,
}) => {
  await page.route('**/general-translation/connection', (route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ error: messages.invalidKey() }),
    })
  );
  try {
    for (const language of [
      { code: 'fr', name: 'Français' },
      { code: 'es', name: 'Español' },
      { code: 'ar', name: 'العربية' },
    ]) {
      await page.goto(`${adminOrigin}/admin/me`);
      await page.getByRole('combobox').first().click();
      await page.getByRole('option', { name: language.name, exact: true }).click();
      const saved = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/admin/users/me' &&
          response.request().method() === 'PUT'
      );
      await page.locator('button[type="submit"]').click();
      expect((await saved).status()).toBe(200);
      const dictionary = z
        .record(z.string(), z.string())
        .parse(
          JSON.parse(
            await readFile(
              resolve(
                import.meta.dirname,
                `../../../../packages/plugin/admin/src/translations/${language.code}.json`
              ),
              'utf8'
            )
          )
        );
      const projectLabel = dictionary['settings.project'];
      const saveLabel = dictionary['settings.save'];
      const connectionLabel = dictionary['settings.test'];
      const rejectedLabel = dictionary['diagnostic.invalid-key.happened'];
      if (!projectLabel || !saveLabel || !connectionLabel || !rejectedLabel)
        throw new Error('The translated settings labels are unavailable');
      await page.getByRole('link').and(page.locator('[href="/admin/settings"]')).click();
      await page
        .getByRole('link')
        .and(page.locator('[href="/admin/settings/general-translation"]'))
        .click();
      await expect(page.getByRole('textbox', { name: projectLabel, exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: saveLabel, exact: true })).toBeVisible();
      await page.getByRole('button', { name: connectionLabel, exact: true }).click();
      await expect(page.getByText(rejectedLabel)).toBeVisible();
      await expect(page.getByText(messages.invalidKey().text, { exact: true })).toHaveCount(0);
      await assertAccessible(page);
    }
  } finally {
    expect(
      (await editor.api.put('/admin/users/me', { data: { preferedLanguage: 'en' } })).status()
    ).toBe(200);
  }
});
