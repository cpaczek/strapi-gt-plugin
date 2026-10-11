import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, symlink, writeFile, rm } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { z } from 'zod';
import type { Core } from '@strapi/strapi';
import plugin from '../../server/src';
import { DEFAULT_SETTINGS } from '../../shared/constants';
import type { PluginSettings } from '../../shared/contracts';
import { startMockGt } from '../../../../tests/apps/acceptance/src/mock-gt';
import { createFixtureEvidence } from './fixture-evidence';
import type { PluginRuntime } from '../../server/src/runtime';

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
const isProcessListener = (value: unknown): value is (...arguments_: unknown[]) => void =>
  typeof value === 'function';

export const startStrapiFixture = async (
  options: { uid?: boolean; gtBaseUrl?: string; locales?: string[] } = {}
) => {
  await mkdir(resolve(root, '.work/server-integration'), { recursive: true });
  const directory = await mkdtemp(resolve(root, '.work/server-integration/app-'));
  const write = async (path: string, value: unknown, json = false) => {
    const target = resolve(directory, path);
    await mkdir(resolve(target, '..'), { recursive: true });
    await writeFile(target, json ? JSON.stringify(value) : String(value), { mode: 0o600 });
  };
  const key = randomBytes(32).toString('hex');
  const mock = await startMockGt({ apiKey: key });
  const evidence = await createFixtureEvidence(
    resolve(root, '.work/server-stability', `fixture-${basename(directory)}-${process.pid}.jsonl`),
    [mock.url, ...(options.gtBaseUrl ? [new URL(options.gtBaseUrl).origin] : [])]
  );
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
  if (options.uid)
    Object.assign(schema.attributes, {
      slug: { type: 'uid', targetField: 'title', pluginOptions: { i18n: { localized: true } } },
    });
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
    `module.exports = ${JSON.stringify({ 'general-translation': { enabled: true, resolve: resolve(directory, 'plugin'), config: { baseUrl: options.gtBaseUrl ?? mock.url } } })};`
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
  Object.assign(schema.attributes, {
    card: {
      type: 'component',
      component: 'editorial.card',
      repeatable: false,
      pluginOptions: { i18n: { localized: true } },
    },
    cards: {
      type: 'component',
      component: 'editorial.card',
      repeatable: true,
      pluginOptions: { i18n: { localized: true } },
    },
    sections: {
      type: 'dynamiczone',
      components: ['editorial.card'],
      pluginOptions: { i18n: { localized: true } },
    },
  });
  await write(
    'src/components/editorial/card.json',
    {
      collectionName: 'server_cards',
      info: { displayName: 'Server card' },
      attributes: {
        title: { type: 'string' },
        count: { type: 'integer' },
        image: { type: 'media', multiple: false },
      },
    },
    true
  );
  await write('src/api/article/content-types/article/schema.json', schema, true);
  await write(
    'src/api/note/content-types/note/schema.json',
    {
      ...schema,
      collectionName: 'server_notes',
      info: { singularName: 'note', pluralName: 'notes', displayName: 'Server note' },
      options: { draftAndPublish: false },
    },
    true
  );
  await write('src/index.js', 'module.exports = {};');
  await mkdir(resolve(directory, 'public/uploads'), { recursive: true });
  let strapi: Core.Strapi | undefined;
  let runtime: PluginRuntime | undefined;
  const listeners = process
    .eventNames()
    .map((event) => ({ event, handlers: process.rawListeners(event) }));
  const close = async () => {
    const failures: unknown[] = [];
    try {
      if (strapi && runtime) {
        const rows: unknown = await strapi.db
          .query('plugin::general-translation.job')
          .findMany({ select: ['id'], orderBy: { id: 'asc' } });
        for (const row of z.array(record).parse(rows)) {
          const job = await runtime.repository.get(row.id);
          if (job) evidence.job('final-job', job);
        }
      }
      await evidence.flush();
    } catch (failure) {
      failures.push(failure);
    }
    try {
      if (strapi) await strapi.destroy();
    } catch (failure) {
      failures.push(failure);
    }
    for (const { event, handlers } of listeners)
      for (const handler of handlers)
        if (isProcessListener(handler) && !process.rawListeners(event).includes(handler))
          process.on(event, handler);
    try {
      await mock.close();
    } catch (failure) {
      failures.push(failure);
    }
    try {
      await evidence.close();
    } catch (failure) {
      failures.push(failure);
    }
    Reflect.deleteProperty(globalThis, fixtureSymbol);
    if (previousKey === undefined) delete process.env.GT_API_KEY;
    else process.env.GT_API_KEY = previousKey;
    if (previousTelemetry === undefined) delete process.env.STRAPI_TELEMETRY_DISABLED;
    else process.env.STRAPI_TELEMETRY_DISABLED = previousTelemetry;
    try {
      await rm(directory, { recursive: true, force: true });
    } catch (failure) {
      failures.push(failure);
    }
    if (failures.length)
      throw new AggregateError(failures, 'The Strapi fixture could not finish cleanup');
  };
  try {
    strapi = createStrapi({ appDir: directory, distDir: directory });
    await strapi.load();
    runtime = plugin.services.translation({ strapi });
    await runtime.worker.stop();
    for (const code of options.locales ?? ['fr', 'ar'])
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
          ...(options.uid ? { slug: 'fixture-source-hello' } : {}),
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
    return {
      strapi,
      runtime,
      evidencePath: evidence.path,
      actorId: actor.id,
      source,
      assetId: asset.id,
      settings,
      mock,
      close,
    };
  } catch (failure) {
    try {
      await close();
    } catch (cleanupFailure) {
      throw new AggregateError(
        [failure, cleanupFailure],
        'Strapi initialization failed and cleanup reported an additional error'
      );
    }
    throw failure;
  }
};
