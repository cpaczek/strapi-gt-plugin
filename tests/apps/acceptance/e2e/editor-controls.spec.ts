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
  const login = page.waitForResponse(
    (response) =>
      /\/admin\/(login|register-admin)$/.test(new URL(response.url()).pathname) &&
      response.request().method() === 'POST'
  );
  await signIn(page, account);
  const credentials = z
    .object({ data: z.object({ token: z.string() }) })
    .parse(await (await login).json());
  return request.newContext({
    baseURL: adminOrigin,
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
      const context = await browser.newContext();
      const page = await context.newPage();
      const api = await authenticatedApi(page);
      try {
        await use({ api, storage: await context.storageState() });
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
  await modal
    .getByRole('button', { name: force ? 'Force retranslate' : 'Translate', exact: true })
    .click();
  const response = await queued;
  expect(response.status()).toBe(200);
  await expect(modal.getByText(/Translation jobs were queued/)).toBeVisible();
  const jobs = enqueueSchema.parse(await response.json()).jobs;
  await assertAccessible(page);
  await modal.getByRole('button', { name: 'Close', exact: true }).click();
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
  await page.goto(`${adminOrigin}/admin${collection}?locale=en`);
  await dismissEditorTour(page);
  for (const source of [first, second]) {
    const row = page
      .getByRole('row')
      .filter({ has: page.getByText(source.title, { exact: true }) });
    await row.getByRole('checkbox').check();
  }
  await page.getByRole('button', { name: 'Translate selected', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Translate selected' });
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
  const restricted = await browser.newContext();
  const restrictedPage = await restricted.newPage();
  const restrictedApi = await authenticatedApi(restrictedPage, account);
  try {
    await openDocument(restrictedPage, source);
    await expect(
      restrictedPage.getByRole('button', { name: 'Translate', exact: true })
    ).toHaveCount(0);
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
    await restrictedPage
      .getByRole('row')
      .filter({ hasText: source.title })
      .getByRole('checkbox')
      .check();
    await expect(
      restrictedPage.getByRole('button', { name: 'Translate selected', exact: true })
    ).toHaveCount(0);
    await assertAccessible(restrictedPage);
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
  const restricted = await browser.newContext();
  const page = await restricted.newPage();
  const api = await authenticatedApi(page, account);
  const settingsRequests: string[] = [];
  page.on('request', (outgoing) => {
    if (new URL(outgoing.url()).pathname === '/general-translation/settings')
      settingsRequests.push(outgoing.method());
  });
  try {
    await openDocument(page, source);
    await expect(
      page.getByRole('button', { name: 'Translate', exact: true }).first()
    ).toBeVisible();
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
      if (!projectLabel || !saveLabel)
        throw new Error('The translated settings labels are unavailable');
      await page.goto(`${adminOrigin}/admin/settings/general-translation`);
      await expect(page.getByRole('textbox', { name: projectLabel, exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: saveLabel, exact: true })).toBeVisible();
      await assertAccessible(page);
    }
  } finally {
    expect(
      (await editor.api.put('/admin/users/me', { data: { preferedLanguage: 'en' } })).status()
    ).toBe(200);
  }
});
