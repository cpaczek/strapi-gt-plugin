import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, symlink, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { z } from 'zod';
import type { Core } from '@strapi/strapi';
import plugin from '../../server/src';
import { DEFAULT_SETTINGS } from '../../shared/constants';
import type { PluginSettings } from '../../shared/contracts';
import { startMockGt } from '../../../../tests/apps/acceptance/src/mock-gt';

const root = resolve(import.meta.dirname, '../../../..');
const framework: unknown = createRequire(resolve(root, 'playground/package.json'))(
  '@strapi/strapi'
);
const isFramework = (
  value: unknown
): value is Pick<typeof import('@strapi/strapi'), 'createStrapi'> =>
  typeof value === 'object' &&
  value !== null &&
  'createStrapi' in value &&
  typeof value.createStrapi === 'function';
if (!isFramework(framework)) throw new Error('The public Strapi constructor is unavailable');
const createStrapi = framework.createStrapi;
const record = z.object({ id: z.number() }).passthrough();
const sourceRecord = record.extend({ documentId: z.string(), locale: z.string() });
const fixtureSymbol = Symbol.for('general-translation.real-server-test');

export const startStrapiFixture = async () => {
  await mkdir(resolve(root, '.work/server-integration'), { recursive: true });
  const directory = await mkdtemp(resolve(root, '.work/server-integration/app-'));
  const write = async (path: string, value: unknown, json = false) => {
    const target = resolve(directory, path);
    await mkdir(resolve(target, '..'), { recursive: true });
    await writeFile(target, json ? JSON.stringify(value) : String(value), { mode: 0o600 });
  };
  const key = randomBytes(32).toString('hex');
  const mock = await startMockGt({ apiKey: key });
  const previousKey = process.env.GT_API_KEY;
  process.env.GT_API_KEY = key;
  const previousTelemetry = process.env.STRAPI_TELEMETRY_DISABLED;
  process.env.STRAPI_TELEMETRY_DISABLED = 'true';
  Object.defineProperty(globalThis, fixtureSymbol, { value: plugin, configurable: true });
  const schema = {
    kind: 'collectionType',
    collectionName: 'server_articles',
    info: { singularName: 'article', pluralName: 'articles', displayName: 'Server article' },
    options: { draftAndPublish: true },
    pluginOptions: { i18n: { localized: true } },
    attributes: {
      title: { type: 'string', required: true, pluginOptions: { i18n: { localized: true } } },
      summary: { type: 'text', pluginOptions: { i18n: { localized: true } } },
      image: { type: 'media', multiple: false, pluginOptions: { i18n: { localized: true } } },
    },
  };
  await write(
    'package.json',
    {
      name: 'gt-server-test-app',
      version: '0.0.0',
      private: true,
      dependencies: { '@strapi/strapi': '5.57.0' },
    },
    true
  );
  await symlink(
    resolve(root, 'playground/node_modules'),
    resolve(directory, 'node_modules'),
    'dir'
  );
  await write(
    'plugin/package.json',
    {
      name: 'strapi-plugin-general-translation',
      version: '0.1.0',
      type: 'commonjs',
      strapi: { kind: 'plugin', name: 'general-translation', displayName: 'General Translation' },
      exports: { './strapi-server': './server.js' },
    },
    true
  );
  await write(
    'plugin/server.js',
    "module.exports = globalThis[Symbol.for('general-translation.real-server-test')];"
  );
  await write(
    'config/plugins.js',
    `module.exports = ${JSON.stringify({ 'general-translation': { enabled: true, resolve: resolve(directory, 'plugin'), config: { baseUrl: mock.url } } })};`
  );
  await write(
    'config/server.js',
    `module.exports = ${JSON.stringify({ host: '127.0.0.1', port: 0, app: { keys: [randomBytes(32).toString('hex'), randomBytes(32).toString('hex')] } })};`
  );
  await write(
    'config/admin.js',
    `module.exports = ${JSON.stringify({ auth: { secret: randomBytes(32).toString('hex') }, apiToken: { salt: randomBytes(32).toString('hex') }, transfer: { token: { salt: randomBytes(32).toString('hex') } }, secrets: { encryptionKey: randomBytes(32).toString('hex') } })};`
  );
  await write('config/logger.js', "module.exports = { level: 'error' };");
  await write(
    'config/database.js',
    `module.exports = ${JSON.stringify({ connection: { client: 'sqlite', connection: { filename: resolve(directory, 'test.db') }, useNullAsDefault: true } })};`
  );
  await write('src/api/article/content-types/article/schema.json', schema, true);
  await write('src/index.js', 'module.exports = {};');
  await mkdir(resolve(directory, 'public/uploads'), { recursive: true });
  let strapi: Core.Strapi | undefined;
  const listeners = process
    .eventNames()
    .map((event) => ({ event, handlers: process.rawListeners(event) }));
  const close = async () => {
    if (strapi) {
      await strapi.destroy();
      for (const { event, handlers } of listeners)
        for (const handler of handlers)
          if (!process.rawListeners(event).includes(handler)) process.on(event, handler);
    }
    await mock.close();
    Reflect.deleteProperty(globalThis, fixtureSymbol);
    if (previousKey === undefined) delete process.env.GT_API_KEY;
    else process.env.GT_API_KEY = previousKey;
    if (previousTelemetry === undefined) delete process.env.STRAPI_TELEMETRY_DISABLED;
    else process.env.STRAPI_TELEMETRY_DISABLED = previousTelemetry;
    await rm(directory, { recursive: true, force: true });
  };
  try {
    strapi = createStrapi({ appDir: directory, distDir: directory });
    await strapi.load();
    const runtime = plugin.services.translation({ strapi });
    await runtime.worker.stop();
    for (const code of ['fr', 'ar'])
      await strapi.db.query('plugin::i18n.locale').create({ data: { code, name: code } });
    const role = record.parse(
      await strapi.db.query('admin::role').findOne({ where: { code: 'strapi-super-admin' } })
    );
    const actor = record.parse(
      await strapi.db.query('admin::user').create({
        data: {
          firstname: 'Test',
          lastname: 'Editor',
          email: 'server@example.invalid',
          isActive: true,
          roles: [role.id],
        },
      })
    );
    const asset = record.parse(
      await strapi.db.query('plugin::upload.file').create({
        data: {
          name: 'Sky',
          hash: 'server-fixture-sky',
          ext: '.svg',
          mime: 'image/svg+xml',
          size: 1,
          url: '/sky.svg',
          provider: 'local',
          alternativeText: 'Clouds',
          caption: 'Blue sky',
        },
      })
    );
    const source = sourceRecord.parse(
      await strapi.documents('api::article.article').create({
        locale: 'en',
        data: {
          title: 'Hello',
          summary: 'A quiet day',
          image: asset.id,
          createdBy: actor.id,
          updatedBy: actor.id,
        },
      })
    );
    const settings: PluginSettings = {
      ...DEFAULT_SETTINGS,
      projectId: 'editorial',
      sourceLocale: 'en',
      targetLocales: ['fr', 'ar'],
      createMissingLocales: true,
      contentTypes: {
        'api::article.article': {
          mediaMetadata: true,
          fields: {
            title: { translate: true },
            summary: { translate: true },
            image: { translate: true },
          },
        },
      },
    };
    await runtime.saveSettings(settings);
    return { strapi, runtime, actorId: actor.id, source, assetId: asset.id, settings, mock, close };
  } catch (failure) {
    await close();
    throw failure;
  }
};
