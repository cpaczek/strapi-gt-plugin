import { randomBytes, randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { z } from 'zod';
import { PERMISSIONS, UI_POLL_MS } from '../../../../packages/plugin/shared/constants';
import { messages } from '../../../../packages/plugin/shared/messages';
import { createEditorApi } from '../src/editor-api';
import { adminOrigin, signIn, type TestAccount } from './editor-session';

const identified = z.object({ data: z.object({ id: z.number() }) });
const authenticatedApi = async (page: Page, account?: TestAccount): Promise<APIRequestContext> => {
  const [response] = await Promise.all([
    page.waitForResponse(
      (entry) =>
        /\/admin\/(login|register-admin)$/.test(new URL(entry.url()).pathname) &&
        entry.request().method() === 'POST'
    ),
    signIn(page, account),
  ]);
  const login = z.object({ data: z.object({ token: z.string() }) }).parse(await response.json());
  return createEditorApi(adminOrigin, login.data.token);
};

test('Jobs navigation and direct polling match each native plugin role grant', async ({
  browser,
  page,
}, testInfo) => {
  const api = await authenticatedApi(page);
  const owned: { users: number[]; roles: number[] } = { users: [], roles: [] };
  try {
    for (const action of [
      PERMISSIONS.writeSettings,
      PERMISSIONS.readSettings,
      PERMISSIONS.translate,
      PERMISSIONS.bulkTranslate,
    ]) {
      const suffix = randomUUID();
      const roleResponse = await api.post('/admin/roles', {
        data: {
          name: `Jobs role ${suffix}`,
          description: 'Isolated Jobs navigation acceptance role',
        },
      });
      expect(roleResponse.status()).toBe(201);
      const role = identified.parse(await roleResponse.json()).data.id;
      owned.roles.push(role);
      const permissionResponse = await api.put(`/admin/roles/${role}/permissions`, {
        data: {
          permissions: [
            { action, subject: null, properties: {}, conditions: [] },
            {
              action: 'plugin::content-manager.explorer.read',
              subject: 'api::article.article',
              properties: { fields: ['title'], locales: ['en'] },
              conditions: [],
            },
          ],
        },
      });
      expect(permissionResponse.status()).toBe(200);
      const account = {
        email: `jobs-${suffix}@example.invalid`,
        password: `${randomBytes(16).toString('hex')}Aa1!`,
      };
      const created = await api.post('/admin/users', {
        data: { firstname: 'Jobs', lastname: 'Editor', email: account.email, roles: [role] },
      });
      expect(created.status()).toBe(201);
      const user = identified.parse(await created.json()).data.id;
      owned.users.push(user);
      expect(
        (
          await api.put(`/admin/users/${user}`, {
            data: { password: account.password, isActive: true },
          })
        ).status()
      ).toBe(200);
      const context: BrowserContext = await browser.newContext();
      let limited: APIRequestContext | undefined;
      try {
        const editor = await context.newPage();
        limited = await authenticatedApi(editor, account);
        const grants = await limited.get('/admin/users/me/permissions');
        expect(grants.status()).toBe(200);
        const permissions = z
          .object({ data: z.array(z.object({ action: z.string() })) })
          .parse(await grants.json());
        expect(
          permissions.data
            .filter((grant) => grant.action.startsWith('plugin::general-translation.'))
            .map((grant) => grant.action)
        ).toEqual([action]);
        const history = await limited.get('/general-translation/jobs');
        expect(history.status()).toBe(action === PERMISSIONS.writeSettings ? 403 : 200);
        const menu = editor.getByRole('link', { name: 'Job history', exact: true });
        if (action === PERMISSIONS.writeSettings) {
          await expect(menu).toHaveCount(0);
          let requests = 0;
          editor.on('request', (request) => {
            if (new URL(request.url()).pathname === '/general-translation/jobs') requests += 1;
          });
          await editor.clock.install();
          await editor.goto(`${adminOrigin}/admin/plugins/general-translation`);
          await expect(
            editor.getByText(messages.permissionDenied().text, { exact: true })
          ).toBeVisible();
          await editor.clock.runFor(UI_POLL_MS * 2);
          expect(requests).toBe(0);
          await editor.screenshot({
            path: testInfo.outputPath('write-settings-only-denied.png'),
            fullPage: true,
          });
        } else {
          await expect(menu).toBeVisible();
          const loaded = editor.waitForResponse(
            (response) => new URL(response.url()).pathname === '/general-translation/jobs'
          );
          await menu.click();
          expect((await loaded).status()).toBe(200);
          await expect(
            editor.getByRole('heading', { name: 'Job history', exact: true })
          ).toBeVisible();
        }
      } finally {
        if (limited) await limited.dispose();
        await context.close();
      }
    }
  } finally {
    for (const user of owned.users)
      expect((await api.delete(`/admin/users/${user}`)).status()).toBe(200);
    for (const role of owned.roles)
      expect((await api.delete(`/admin/roles/${role}`)).status()).toBe(200);
    await api.dispose();
  }
});
