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
import { readMockControls } from '../src/mock-controls';
import { messages } from '../../../../packages/plugin/shared/messages';
import { jobsSchema, enqueueSchema } from '../../../../packages/plugin/admin/src/api';
import { assertAccessible } from './accessibility';
import {
  adminOrigin,
  configureTranslation,
  openDocument,
  openTranslation,
  ensureEditorTourHandler,
  openSettings,
  saveSettings,
  sourceTitle,
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
    await ensureEditorTourHandler(page);
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

const selectTranslationFields = async (page: Page, paths: string[]) => {
  await openSettings(page);
  const labels = (await page.locator('label').allTextContents()).map((label) => label.trim());
  for (const label of labels.filter(
    (label) => label.startsWith('Translate ') && !label.startsWith('Translate media ')
  )) {
    const checkbox = page.getByRole('checkbox', { name: label, exact: true });
    if (await checkbox.isEnabled())
      await checkbox.setChecked(paths.includes(label.slice('Translate '.length)));
  }
  for (const path of paths)
    await page.getByRole('checkbox', { name: `Translate ${path}`, exact: true }).check();
  await saveSettings(page);
};

const expectReadableHistory = async (page: Page, row: Locator) => {
  const geometry = await row.evaluate((element) => {
    const table = element.closest('table');
    const scrollRegion = table?.parentElement;
    return {
      cellWidths: Array.from(element.querySelectorAll('td'))
        .slice(4)
        .map((cell) => cell.getBoundingClientRect().width),
      contentWidth: scrollRegion?.scrollWidth ?? 0,
      availableWidth: scrollRegion?.clientWidth ?? 0,
    };
  });
  expect(geometry.cellWidths).toHaveLength(2);
  for (const width of geometry.cellWidths) expect(width).toBeLessThanOrEqual(420);
  expect(geometry.contentWidth).toBeLessThanOrEqual(geometry.availableWidth + 1);
};

test('a preexisting human target is protected before its first GT request', async ({
  page,
  editor,
}) => {
  const control = await readMockControls();
  await selectTranslationFields(page, ['title']);
  const source = await editor.createSource('Preexisting human target');
  const manualTitle = `Texte français rédigé par une personne ${randomUUID()}`;
  const created = await editor.api.put(`${collection}/${source.documentId}?locale=fr`, {
    data: { title: 'French draft', slug: `manual-fr-${randomUUID()}` },
  });
  expect(created.status()).toBe(200);
  await openDocument(page, { documentId: source.documentId, locale: 'fr' });
  await page
    .getByRole('textbox', { name: /^title\*?$/i })
    .first()
    .fill(manualTitle);
  await saveDocument(page);
  expect(await readDocumentJobs(editor.api, source.documentId)).toEqual([]);
  const before = await control.counters();
  await openDocument(page, source);
  const ids = await queueFrench(page);
  const protectedJobs = await awaitTerminalJobs(editor.api, source.documentId, ids);
  expect(protectedJobs.map((job) => ({ status: job.status, code: job.error?.code }))).toEqual([
    { status: 'conflict', code: 'human-edit' },
  ]);
  expect(await control.counters()).toEqual(before);
  await openDocument(page, { documentId: source.documentId, locale: 'fr' });
  await expect(page.getByRole('textbox', { name: /^title\*?$/i }).first()).toHaveValue(manualTitle);
  await page.goto(`${adminOrigin}/admin/plugins/general-translation`);
  const currentRow = () => page.getByRole('row').filter({ hasText: source.documentId });
  await expect(currentRow().getByText('Needs review', { exact: true })).toBeVisible();
  await expect(currentRow().getByText(messages.humanEdit().text, { exact: true })).toBeVisible();
  await expect(currentRow().getByRole('button', { name: /Retry job/ })).toHaveCount(0);
  await expect(
    currentRow().getByText(/Review this document in Content Manager and start a new translation/)
  ).toBeVisible();
  await expectReadableHistory(page, currentRow());
  await assertAccessible(page);
  const changeLanguage = async (name: string) => {
    await page.goto(`${adminOrigin}/admin/me`);
    await page.getByRole('combobox').first().click();
    await page.getByRole('option', { name, exact: true }).click();
    const saved = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/admin/users/me' &&
        response.request().method() === 'PUT'
    );
    await page.locator('button[type="submit"]').click();
    expect((await saved).status()).toBe(200);
  };
  try {
    for (const language of [
      {
        code: 'es',
        name: 'Español',
        happened: 'Un campo de destino está protegido contra la sustitución',
      },
      {
        code: 'fr',
        name: 'Français',
        happened: 'Un champ cible est protégé contre le remplacement',
      },
      { code: 'ar', name: 'العربية', happened: 'أحد الحقول المستهدفة محمي من الاستبدال' },
    ]) {
      await changeLanguage(language.name);
      await page.goto(`${adminOrigin}/admin/plugins/general-translation`);
      await page.getByRole('main').focus();
      await expect(currentRow().getByText(language.happened, { exact: false })).toBeVisible();
      await expect(currentRow().getByText(messages.humanEdit().text, { exact: true })).toHaveCount(
        0
      );
      await expect(currentRow().getByRole('button')).toHaveCount(0);
      await expectReadableHistory(page, currentRow());
      if (language.code === 'ar') {
        await page.setViewportSize({ width: 768, height: 900 });
        const cells = currentRow().getByRole('gridcell');
        await cells.first().focus();
        await page.keyboard.press('End');
        await expect(cells.last()).toBeFocused();
        const bounds = await cells.last().boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds?.x).toBeGreaterThanOrEqual(0);
        expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(768);
        await page.keyboard.press('Home');
        await expect(cells.first()).toBeFocused();
        await page.setViewportSize({ width: 1280, height: 720 });
        await expectReadableHistory(page, currentRow());
      }
      await assertAccessible(page);
      await page.screenshot({
        path: `../../../.work/screenshots/review2-preexisting-${language.code}.png`,
        fullPage: true,
      });
    }
    await changeLanguage('English');
    await openDocument(page, source);
    const forcedIds = await queueFrench(page, true);
    expect(forcedIds.every((id) => !ids.includes(id))).toBe(true);
    expect(
      (await awaitTerminalJobs(editor.api, source.documentId, forcedIds)).map((job) => job.status)
    ).toEqual(['succeeded']);
    await openDocument(page, { documentId: source.documentId, locale: 'fr' });
    await expect(page.getByRole('textbox', { name: /^title\*?$/i }).first()).toHaveValue(
      `[fr] ${source.title}`
    );
  } finally {
    expect(
      (await editor.api.put('/admin/users/me', { data: { preferedLanguage: 'en' } })).status()
    ).toBe(200);
  }
});

test('native optional text clearing preserves manual targets until force', async ({
  page,
  editor,
}) => {
  const control = await readMockControls();
  await selectTranslationFields(page, ['summary']);
  const source = await editor.createSource('Optional text clearing');
  expect(
    (
      await editor.api.put(`${collection}/${source.documentId}?locale=fr`, {
        data: { title: source.title, slug: `clear-fr-${randomUUID()}` },
      })
    ).status()
  ).toBe(200);
  const readSummary = async (locale: string) => {
    const response = await editor.api.get(`${collection}/${source.documentId}?locale=${locale}`);
    expect(response.status()).toBe(200);
    return z
      .object({ data: z.object({ summary: z.string().nullable() }) })
      .parse(await response.json()).data.summary;
  };
  await openDocument(page, source);
  const first = await queueFrench(page);
  expect(
    (await awaitTerminalJobs(editor.api, source.documentId, first)).map((job) => job.status)
  ).toEqual(['succeeded']);
  expect(await readSummary('fr')).toBe('[fr] A field note for translation acceptance.');
  await page.getByRole('textbox', { name: /^summary$/i }).fill('');
  await saveDocument(page);
  const initialClear = await readSummary('en');
  expect([null, '']).toContain(initialClear);
  const beforeClear = await control.counters();
  const cleared = await queueFrench(page);
  expect(
    (await awaitTerminalJobs(editor.api, source.documentId, cleared)).map((job) => job.status)
  ).toEqual(['succeeded']);
  expect(await readSummary('fr')).toBe(initialClear);
  expect(await control.counters()).toEqual(beforeClear);
  await page.getByRole('textbox', { name: /^summary$/i }).fill('Restored source text');
  await saveDocument(page);
  const restored = await queueFrench(page);
  expect(
    (await awaitTerminalJobs(editor.api, source.documentId, restored)).map((job) => job.status)
  ).toEqual(['succeeded']);
  const manual = `Résumé humain ${randomUUID()}`;
  await openDocument(page, { documentId: source.documentId, locale: 'fr' });
  await page.getByRole('textbox', { name: /^summary$/i }).fill(manual);
  await saveDocument(page);
  await openDocument(page, source);
  await page.getByRole('textbox', { name: /^summary$/i }).fill('');
  await saveDocument(page);
  const manualClear = await readSummary('en');
  expect([null, '']).toContain(manualClear);
  const beforeProtection = await control.counters();
  const protectedIds = await queueFrench(page);
  expect(
    (await awaitTerminalJobs(editor.api, source.documentId, protectedIds)).map((job) => ({
      status: job.status,
      code: job.error?.code,
    }))
  ).toEqual([{ status: 'conflict', code: 'human-edit' }]);
  expect(await readSummary('fr')).toBe(manual);
  expect(await control.counters()).toEqual(beforeProtection);
  const forced = await queueFrench(page, true);
  expect(
    (await awaitTerminalJobs(editor.api, source.documentId, forced)).map((job) => job.status)
  ).toEqual(['succeeded']);
  expect(await readSummary('fr')).toBe(manualClear);
  expect(await control.counters()).toEqual(beforeProtection);
  await openDocument(page, { documentId: source.documentId, locale: 'fr' });
  await expect(page.getByRole('textbox', { name: /^summary$/i })).toHaveValue('');
  await expect(page.getByRole('textbox', { name: /^title\*?$/i }).first()).toHaveValue(
    source.title
  );
  await base.info().attach('native-clearing-values', {
    contentType: 'application/json',
    body: JSON.stringify({
      firstSave: initialClear,
      afterManualEdit: manualClear,
      translationRequestsAdded: 0,
    }),
  });
  await assertAccessible(page, 'section[aria-label="General Translation controls"]');
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

const clearFieldContexts = async (page: Page) => {
  await openSettings(page);
  const contexts = page.getByRole('textbox', { name: /^Context for / });
  expect(await contexts.count()).toBeGreaterThan(0);
  for (const context of await contexts.all()) if (await context.isEnabled()) await context.fill('');
  await saveSettings(page);
};
const largeSummary = 'Enderman 🧱 keeps this field note for the editorial archive. '.repeat(180);
const readDocumentJobs = async (api: APIRequestContext, documentId: string) => {
  const query = new URLSearchParams({ contentType: model, documentId });
  const response = await api.get(`/general-translation/jobs?${query}`);
  expect(response.status()).toBe(200);
  return jobsSchema.parse(await response.json()).jobs;
};
const awaitTerminalJobs = async (api: APIRequestContext, documentId: string, ids: number[]) => {
  await expect
    .poll(
      async () => {
        const jobs = (await readDocumentJobs(api, documentId)).filter((job) =>
          ids.includes(job.id)
        );
        return (
          jobs.length === ids.length &&
          jobs.every((job) => ['succeeded', 'failed', 'conflict'].includes(job.status))
        );
      },
      { timeout: 60_000 }
    )
    .toBe(true);
  return (await readDocumentJobs(api, documentId)).filter((job) => ids.includes(job.id));
};

test('a large article translates through files after the editor clears field context', async ({
  page,
  editor,
}) => {
  const control = await readMockControls();
  const before = await control.counters();
  const source = await editor.createSource('Large article cleared context');
  await clearFieldContexts(page);
  await openDocument(page, source);
  await page.getByRole('textbox', { name: /^summary$/i }).fill(largeSummary);
  await saveDocument(page);
  const ids = await queueFrench(page);
  const jobs = await awaitTerminalJobs(editor.api, source.documentId, ids);
  expect(jobs.map((job) => job.status)).toEqual(['succeeded']);
  const after = await control.counters();
  expect(after.uploads).toBeGreaterThan(before.uploads);
  expect(after.enqueues).toBeGreaterThan(before.enqueues);
  expect(after.downloads).toBeGreaterThan(before.downloads);
  expect(after.runtimeRequests).toBe(before.runtimeRequests);
  await openDocument(page, { documentId: source.documentId, locale: 'fr' });
  await expect(page.getByRole('textbox', { name: /^summary$/i })).toHaveValue(
    `[fr] ${largeSummary}`
  );
  await assertAccessible(page, 'section[aria-label="General Translation controls"]');
});

test('a genuine source conflict requires review and a new editor translation', async ({
  page,
  editor,
}) => {
  const control = await readMockControls();
  const source = await editor.createSource('Conflict recovery');
  await clearFieldContexts(page);
  await openDocument(page, source);
  await page.getByRole('textbox', { name: /^summary$/i }).fill(largeSummary);
  await saveDocument(page);
  await control.setJobStatus('processing');
  try {
    const ids = await queueFrench(page);
    await expect
      .poll(
        async () =>
          (await readDocumentJobs(editor.api, source.documentId)).find((job) =>
            ids.includes(job.id)
          )?.status
      )
      .toBe('waiting');
    const revision = `${largeSummary} The editor saved a later revision.`;
    await page.getByRole('textbox', { name: /^summary$/i }).fill(revision);
    await saveDocument(page);
    await control.setJobStatus('completed');
    const conflicted = await awaitTerminalJobs(editor.api, source.documentId, ids);
    expect(conflicted.map((job) => job.status)).toEqual(['conflict']);
    await page.goto(`${adminOrigin}/admin/plugins/general-translation`);
    const row = page.getByRole('row').filter({ hasText: source.documentId });
    await expect(row.getByText('Needs review', { exact: true })).toBeVisible();
    await expect(row.getByRole('button', { name: /Retry job/ })).toHaveCount(0);
    await expect(
      row.getByText(/Review this document in Content Manager and start a new translation/)
    ).toBeVisible();
    await assertAccessible(page);
    await row
      .getByText(/Review this document in Content Manager and start a new translation/)
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: '../../../.work/screenshots/review-conflict-recovery.png',
      fullPage: true,
    });
    const manager = page.getByRole('link', { name: 'Content Manager', exact: true });
    await manager.focus();
    await manager.press('Enter');
    await page.getByRole('link', { name: 'Article', exact: true }).click();
    const documentLink = page
      .getByRole('row')
      .filter({ has: page.getByText(source.title, { exact: true }) })
      .getByRole('link')
      .first();
    await documentLink.focus();
    await documentLink.press('Enter');
    await expect(page.getByRole('textbox', { name: /^summary$/i })).toHaveValue(revision);
    const newIds = await queueFrench(page);
    expect(newIds.every((id) => !ids.includes(id))).toBe(true);
    const recovered = await awaitTerminalJobs(editor.api, source.documentId, newIds);
    expect(recovered.map((job) => job.status)).toEqual(['succeeded']);
    await openDocument(page, { documentId: source.documentId, locale: 'fr' });
    await expect(page.getByRole('textbox', { name: /^summary$/i })).toHaveValue(`[fr] ${revision}`);
  } finally {
    await control.setJobStatus('completed');
  }
});

test('a worker source-locale failure retains its detail in English and French history', async ({
  page,
  editor,
}) => {
  const source = await editor.createSource('Source locale diagnostic');
  await clearFieldContexts(page);
  await openDocument(page, source);
  await page.getByRole('textbox', { name: /^summary$/i }).fill(largeSummary);
  await saveDocument(page);
  const first = await queueFrench(page);
  expect(
    (await awaitTerminalJobs(editor.api, source.documentId, first)).map((job) => job.status)
  ).toEqual(['succeeded']);
  await openSettings(page);
  await page.getByRole('combobox', { name: 'Source locale', exact: true }).click();
  await page.getByRole('option', { name: 'French (fr)', exact: true }).click();
  await page.getByRole('checkbox', { name: 'English (en)', exact: true }).uncheck();
  await page.getByRole('checkbox', { name: 'Arabic (ar)', exact: true }).check();
  await saveSettings(page);
  await openDocument(page, { documentId: source.documentId, locale: 'fr' });
  await openTranslation(page);
  const modal = page.getByRole('dialog', { name: 'Translate content' });
  await expect(modal.getByRole('checkbox', { name: 'Arabic (ar)', exact: true })).toBeChecked();
  const queued = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/general-translation/translate' &&
      response.request().method() === 'POST'
  );
  await modal.getByRole('button', { name: 'Translate', exact: true }).click();
  const response = await queued;
  expect(response.status()).toBe(200);
  const ids = enqueueSchema.parse(await response.json()).jobs.map((job) => job.id);
  const failed = await awaitTerminalJobs(editor.api, source.documentId, ids);
  expect(
    failed.map((job) => ({
      status: job.status,
      code: job.error?.code,
      locale: job.error?.details.locale,
    }))
  ).toEqual([{ status: 'failed', code: 'source-locale-mismatch', locale: 'en' }]);
  await page.goto(`${adminOrigin}/admin/plugins/general-translation`);
  await expect(
    page.getByText(messages.sourceLocaleMismatch('en').text, { exact: true })
  ).toBeVisible();
  await assertAccessible(page);
  try {
    await page.goto(`${adminOrigin}/admin/me`);
    await page.getByRole('combobox').first().click();
    await page.getByRole('option', { name: 'Français', exact: true }).click();
    const saved = page.waitForResponse(
      (incoming) =>
        new URL(incoming.url()).pathname === '/admin/users/me' &&
        incoming.request().method() === 'PUT'
    );
    await page.locator('button[type="submit"]').click();
    expect((await saved).status()).toBe(200);
    await page.goto(`${adminOrigin}/admin/plugins/general-translation`);
    await page.getByRole('main').focus();
    await expect(
      page.getByText(
        'General Translation: Le projet GT utilise une langue source différente. Sélectionnez le projet GT correspondant avant de téléverser les fichiers de traduction. en.',
        { exact: true }
      )
    ).toBeVisible();
    await assertAccessible(page);
    await page.screenshot({
      path: '../../../.work/screenshots/review-worker-diagnostic-fr.png',
      fullPage: true,
    });
  } finally {
    expect(
      (await editor.api.put('/admin/users/me', { data: { preferedLanguage: 'en' } })).status()
    ).toBe(200);
  }
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
  await expect(
    page.getByText(/Review the request details, correct the settings or content, and try again/)
  ).toBeVisible();
  await expect(page.getByText(/highlighted settings/)).toHaveCount(0);
  expect((await editor.api.get('/general-translation/settings')).status()).toBe(200);
  await assertAccessible(page);
});

test('native profile language selection loads Spanish, French and Arabic plugin labels', async ({
  page,
  editor,
}) => {
  await configureTranslation(page, { mediaMetadata: true });
  const source = await editor.createSource('Localized metadata labels');
  const query = new URLSearchParams({
    locale: 'en',
    status: 'published',
    populate: 'cover',
    'filters[title][$eq]': sourceTitle,
  });
  const published = await fetch(`${adminOrigin}/api/articles?${query}`);
  expect(published.status).toBe(200);
  const asset = z
    .object({
      data: z.array(
        z.object({
          cover: z.object({
            id: z.number(),
            alternativeText: z.string().nullable(),
            caption: z.string().nullable(),
          }),
        })
      ),
    })
    .parse(await published.json()).data[0]?.cover;
  if (!asset) throw new Error('The seeded article cover is unavailable');
  expect(
    (
      await editor.api.put(`${collection}/${source.documentId}?locale=en`, {
        data: { cover: asset.id },
      })
    ).status()
  ).toBe(200);
  await openDocument(page, source);
  await waitForJobs(editor.api, [source.documentId], await queueFrench(page));
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
      const labels =
        language.code === 'fr'
          ? {
              alt: 'Valeur localisée (texte alternatif) : cover',
              caption: 'Valeur localisée (légende) : cover',
            }
          : language.code === 'ar'
            ? {
                alt: 'القيمة الموطّنة لـ نص بديل: cover',
                caption: 'القيمة الموطّنة لـ تعليق توضيحي: cover',
              }
            : undefined;
      if (labels) {
        const controlsLabel = dictionary['translation.controls'];
        const mediaLabel = dictionary['media.title'];
        const chooseLabel = dictionary['translation.open'];
        const forceLabel = dictionary['translation.force'];
        if (!controlsLabel || !mediaLabel || !chooseLabel || !forceLabel)
          throw new Error('Translated editor labels are unavailable');
        await openDocument(page, source);
        const controls = page.getByRole('region', { name: controlsLabel, exact: true });
        await controls.getByRole('button', { name: mediaLabel, exact: true }).click();
        const alternativeText = controls.getByRole('textbox', { name: labels.alt, exact: true });
        await expect(alternativeText).toHaveValue(`[fr] ${asset.alternativeText}`);
        await expect(
          controls.getByRole('textbox', { name: labels.caption, exact: true })
        ).toHaveValue(`[fr] ${asset.caption}`);
        await alternativeText.focus();
        await expect(alternativeText).toBeFocused();
        await alternativeText.press('Tab');
        await expect(controls.getByRole('checkbox').first()).toBeFocused();
        if (language.code === 'fr') {
          await controls.getByRole('button', { name: chooseLabel, exact: true }).click();
          const force = controls.getByRole('checkbox', { name: forceLabel, exact: true });
          await force.focus();
          await force.press('Space');
          await expect(force).toBeChecked();
          await expect(
            controls.getByText(
              /^General Translation: Forcer une nouvelle traduction peut remplacer les modifications humaines dans les langues sélectionnées\./
            )
          ).toBeVisible();
          await expect(
            controls.getByRole('button', { name: forceLabel, exact: true })
          ).toBeDisabled();
          await controls
            .getByText(/^General Translation: Forcer une nouvelle traduction/)
            .scrollIntoViewIfNeeded();
          await page.screenshot({ path: '../../../.work/screenshots/review-force-fr.png' });
        } else {
          await expect(
            controls.getByText(`القيمة الأصلية لـ نص بديل: ${asset.alternativeText}`, {
              exact: true,
            })
          ).toBeVisible();
          await expect(
            controls.getByText(`القيمة الأصلية لـ تعليق توضيحي: ${asset.caption}`, { exact: true })
          ).toBeVisible();
        }
        await assertAccessible(page, `section[aria-label=${JSON.stringify(controlsLabel)}]`);
        await controls
          .getByRole('textbox', { name: labels.caption, exact: true })
          .scrollIntoViewIfNeeded();
        await page.screenshot({
          path: `../../../.work/screenshots/review-metadata-${language.code}.png`,
          fullPage: true,
        });
      }
    }
  } finally {
    expect(
      (await editor.api.put('/admin/users/me', { data: { preferedLanguage: 'en' } })).status()
    ).toBe(200);
  }
});
