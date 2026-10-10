import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import type { Core } from '@strapi/strapi';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createTestDatabase, type TestDatabase } from '../src/database';
import { startMockGt, type MockGtServer } from '../src/mock-gt';

const root = resolve(import.meta.dirname, '../../../..');
const framework: unknown = createRequire(resolve(root, 'playground/package.json'))(
  '@strapi/strapi'
);
const isStrapiFramework = (
  value: unknown
): value is Pick<typeof import('@strapi/strapi'), 'compileStrapi' | 'createStrapi'> =>
  typeof value === 'object' &&
  value !== null &&
  'compileStrapi' in value &&
  typeof value.compileStrapi === 'function' &&
  'createStrapi' in value &&
  typeof value.createStrapi === 'function';
if (!isStrapiFramework(framework)) throw new TypeError('Strapi public exports are unavailable');
const { compileStrapi, createStrapi } = framework;
const runtime: { strapi?: Core.Strapi; database?: TestDatabase; mock?: MockGtServer } = {};
const articleRecord = z
  .object({
    documentId: z.string(),
    title: z.string(),
    locale: z.string(),
    publishedAt: z.string().nullable().optional(),
  })
  .passthrough();

beforeAll(async () => {
  runtime.database = await createTestDatabase(root, process.env.DATABASE_CLIENT ?? 'sqlite');
  const mockKey = randomBytes(32).toString('hex');
  runtime.mock = await startMockGt({ apiKey: mockKey });
  Object.assign(process.env, runtime.database.environment, {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '0',
    PLAYGROUND_SEED: 'true',
    APP_KEYS: `${randomBytes(32).toString('hex')},${randomBytes(32).toString('hex')}`,
    ADMIN_JWT_SECRET: randomBytes(32).toString('hex'),
    API_TOKEN_SALT: randomBytes(32).toString('hex'),
    TRANSFER_TOKEN_SALT: randomBytes(32).toString('hex'),
    ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    JWT_SECRET: randomBytes(32).toString('hex'),
    GT_API_KEY: mockKey,
    GT_PROJECT_ID: 'editorial',
    GT_BASE_URL: runtime.mock.url,
    STRAPI_TELEMETRY_DISABLED: 'true',
  });
  const directories = await compileStrapi({ appDir: resolve(root, 'playground') });
  runtime.strapi = await createStrapi(directories).load();
});
afterAll(async () => {
  if (runtime.strapi) await runtime.strapi.destroy();
  if (runtime.mock) await runtime.mock.close();
  if (runtime.database) await runtime.database.close();
});
const app = (): Core.Strapi => {
  if (!runtime.strapi) throw new Error('Strapi did not boot');
  return runtime.strapi;
};

// Each matrix run starts with a new database and real framework services.
describe('real Strapi database behavior', () => {
  it('loads the installed plugin', () => {
    expect(app().plugin('general-translation')).toBeDefined();
  });
  it('seeds both publication controls', async () => {
    const published = await app()
      .documents('api::article.article')
      .findMany({ locale: 'en', status: 'published' });
    const drafts = await app()
      .documents('api::article.article')
      .findMany({ locale: 'en', status: 'draft' });
    expect(published).toHaveLength(3);
    expect(drafts).toHaveLength(4);
  });
  it('creates a localized draft under the source document identity', async () => {
    const source = articleRecord.parse(
      await app().documents('api::article.article').findFirst({ locale: 'en', status: 'published' })
    );
    const fields: Record<string, string> = {
      title: 'Notes de la côte',
      slug: 'notes-de-la-cote',
      summary: 'Un matin au bord de la mer.',
    };
    await app()
      .documents('api::article.article')
      .update({ documentId: source.documentId, locale: 'fr', data: fields });
    expect(
      await app()
        .documents('api::article.article')
        .findOne({ documentId: source.documentId, locale: 'fr', status: 'published' })
    ).toBeNull();
    const target = articleRecord.parse(
      await app()
        .documents('api::article.article')
        .findOne({ documentId: source.documentId, locale: 'fr', status: 'draft' })
    );
    expect(target.documentId).toBe(source.documentId);
    expect(target.title).toBe('Notes de la côte');
  });
  it('publishes only the selected locale', async () => {
    const source = articleRecord.parse(
      await app().documents('api::article.article').findFirst({ locale: 'en', status: 'published' })
    );
    await app()
      .documents('api::article.article')
      .publish({ documentId: source.documentId, locale: 'fr' });
    expect(
      articleRecord.parse(
        await app()
          .documents('api::article.article')
          .findOne({ documentId: source.documentId, locale: 'fr', status: 'published' })
      ).title
    ).toBe('Notes de la côte');
    expect(
      await app()
        .documents('api::article.article')
        .findOne({ documentId: source.documentId, locale: 'ar', status: 'published' })
    ).toBeNull();
  });
  it('retains a human target edit in the database', async () => {
    const source = articleRecord.parse(
      await app().documents('api::article.article').findFirst({ locale: 'en', status: 'published' })
    );
    const fields: Record<string, string> = { title: 'Titre choisi par la rédaction' };
    await app()
      .documents('api::article.article')
      .update({ documentId: source.documentId, locale: 'fr', data: fields });
    expect(
      articleRecord.parse(
        await app()
          .documents('api::article.article')
          .findOne({ documentId: source.documentId, locale: 'fr', status: 'draft' })
      ).title
    ).toBe('Titre choisi par la rédaction');
    expect(
      articleRecord.parse(
        await app()
          .documents('api::article.article')
          .findOne({ documentId: source.documentId, locale: 'fr', status: 'published' })
      ).title
    ).toBe('Notes de la côte');
  });
});
