import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import type { Core } from '@strapi/strapi';
import type { PluginRuntime } from '../../../../packages/plugin/server/src/runtime';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createTestDatabase, type TestDatabase } from '../src/database';
import { cleanupTestResources } from '../src/cleanup-resources';
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
const isProcessListener = (value: unknown): value is (...arguments_: unknown[]) => void =>
  typeof value === 'function';
const preservedListeners = new Map<string | symbol, ReturnType<typeof process.rawListeners>>();
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
  for (const event of process.eventNames())
    preservedListeners.set(event, process.rawListeners(event));
  runtime.strapi = createStrapi(directories);
  await runtime.strapi.load();
});
afterAll(async () => {
  await cleanupTestResources([
    async () => {
      await runtime.strapi?.destroy();
    },
    () => {
      for (const [event, listeners] of preservedListeners)
        for (const listener of listeners) {
          if (isProcessListener(listener) && !process.rawListeners(event).includes(listener))
            process.on(event, listener);
        }
    },
    async () => {
      await runtime.mock?.close();
    },
    async () => {
      await runtime.database?.close();
    },
  ]);
});

const app = (): Core.Strapi => {
  if (!runtime.strapi) throw new Error('Strapi did not boot');
  return runtime.strapi;
};

const publishWithAcknowledgement = async (documentId: string, locale: string) => {
  const publication = { observed: false };
  const unsubscribe = app().eventHub.on('entry.publish', (payload: unknown) => {
    const event = z
      .object({
        uid: z.string(),
        entry: z.object({ documentId: z.string(), locale: z.string() }),
      })
      .safeParse(payload);
    if (
      event.success &&
      event.data.uid === 'api::article.article' &&
      event.data.entry.documentId === documentId &&
      event.data.entry.locale === locale
    )
      publication.observed = true;
    return Promise.resolve();
  });
  try {
    await app().documents('api::article.article').publish({ documentId, locale });
    await expect.poll(() => publication.observed).toBe(true);
  } finally {
    unsubscribe();
  }
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

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
const isTranslationRuntime = (
  value: unknown
): value is Pick<
  PluginRuntime,
  'enqueue' | 'retry' | 'worker' | 'repository' | 'savedSettings' | 'saveSettings'
> =>
  record(value) &&
  typeof value.enqueue === 'function' &&
  typeof value.retry === 'function' &&
  typeof value.savedSettings === 'function' &&
  typeof value.saveSettings === 'function' &&
  record(value.worker) &&
  typeof value.worker.stop === 'function' &&
  typeof value.worker.execute === 'function' &&
  record(value.repository) &&
  typeof value.repository.get === 'function' &&
  typeof value.repository.state === 'function';

it('runs the durable translation with the initiating actor and records public GT requests', async () => {
  const service: unknown = app().plugin('general-translation').service('translation');
  if (!isTranslationRuntime(service))
    throw new TypeError('Translation runtime did not expose its worker');
  await service.worker.stop();
  const role = z.object({ id: z.number() }).parse(
    await app()
      .db.query('admin::role')
      .findOne({ where: { code: 'strapi-super-admin' } })
  );
  const actor = z.object({ id: z.number() }).parse(
    await app()
      .db.query('admin::user')
      .create({
        data: {
          firstname: 'Norb',
          lastname: 'Test editor',
          email: `${randomBytes(8).toString('hex')}@example.invalid`,
          isActive: true,
          roles: [role.id],
        },
      })
  );
  const source = articleRecord.parse(
    await app().documents('api::article.article').findFirst({ locale: 'en', status: 'published' })
  );
  const queued = await service.enqueue(
    {
      contentType: 'api::article.article',
      documentIds: [source.documentId],
      targetLocales: ['ar'],
      force: false,
    },
    actor.id,
    'translate',
    'published'
  );
  const jobId = queued.jobs[0]?.id;
  if (jobId === undefined) throw new Error('Translation did not create a durable job');
  const finishJob = async (id: number): Promise<void> =>
    expect
      .poll(
        async () => {
          await service.worker.execute();
          const job = await service.repository.get(id);
          if (job?.status === 'failed' || job?.status === 'conflict')
            throw new Error(JSON.stringify(job.error));
          return job?.status;
        },
        { timeout: 60_000, interval: 20 }
      )
      .toBe('succeeded');
  await finishJob(jobId);
  const target = await app()
    .documents('api::article.article')
    .findOne({
      documentId: source.documentId,
      locale: 'ar',
      status: 'draft',
      populate: ['createdBy', 'updatedBy'],
    });
  expect(articleRecord.parse(target).title).toBe(`[ar] ${source.title}`);
  const attribution = z
    .object({ createdBy: z.object({ id: z.number() }), updatedBy: z.object({ id: z.number() }) })
    .parse(target);
  expect(attribution.createdBy.id).toBe(actor.id);
  expect(attribution.updatedBy.id).toBe(actor.id);
  expect(
    await app()
      .documents('api::article.article')
      .findOne({ documentId: source.documentId, locale: 'ar', status: 'published' })
  ).toBeNull();
  const slug = z.object({ slug: z.string().min(1) }).parse(target).slug;
  expect(slug).not.toBe('');
  const category = z.object({ documentId: z.string() }).parse(
    await app()
      .documents('api::category.category')
      .create({
        data: { name: 'Editor assigned category', slug: 'editor-assigned-category' },
      })
  );
  const relation: Record<string, { connect: string[] }> = {
    category: { connect: [category.documentId] },
  };
  await app()
    .documents('api::article.article')
    .update({ documentId: source.documentId, locale: 'ar', data: relation });
  const revisedTitle = `${source.title}: an editor correction`;
  const changedFields: Record<string, string> = { title: revisedTitle };
  await app().documents('api::article.article').update({
    documentId: source.documentId,
    locale: 'en',
    data: changedFields,
  });
  const changed = await service.enqueue(
    {
      contentType: 'api::article.article',
      documentIds: [source.documentId],
      targetLocales: ['ar'],
      force: false,
    },
    actor.id,
    'translate',
    'draft'
  );
  const changedId = changed.jobs[0]?.id;
  if (changedId === undefined) throw new Error('Changed source did not create a durable job');
  expect(changedId).not.toBe(jobId);
  await finishJob(changedId);
  const revised = z
    .object({
      title: z.string(),
      category: z.object({ documentId: z.string() }),
    })
    .parse(
      await app()
        .documents('api::article.article')
        .findOne({
          documentId: source.documentId,
          locale: 'ar',
          status: 'draft',
          populate: ['category'],
        })
    );
  expect(revised.title).toBe(`[ar] ${revisedTitle}`);
  expect(revised.category.documentId).toBe(category.documentId);
  await publishWithAcknowledgement(source.documentId, 'ar');
  expect(
    articleRecord.parse(
      await app()
        .documents('api::article.article')
        .findOne({ documentId: source.documentId, locale: 'ar', status: 'published' })
    ).title
  ).toBe(`[ar] ${revisedTitle}`);
  expect(runtime.mock?.requests.some((request) => request.path === '/v2/translate')).toBe(true);
  expect(JSON.stringify(runtime.mock?.requests)).not.toContain('editor@example.invalid');
});

import { afterEach } from 'vitest';
import type {
  PluginSettings,
  TranslationRequest,
} from '../../../../packages/plugin/shared/contracts';

const translationRuntime = () => {
  const service: unknown = app().plugin('general-translation').service('translation');
  if (!isTranslationRuntime(service)) throw new TypeError('Translation service is unavailable');
  return service;
};
const createEditor = async (active = true) => {
  const role = z.object({ id: z.number() }).parse(
    await app()
      .db.query('admin::role')
      .findOne({ where: { code: 'strapi-super-admin' } })
  );
  return z.object({ id: z.number() }).parse(
    await app()
      .db.query('admin::user')
      .create({
        data: {
          firstname: 'Concurrent',
          lastname: 'Editor',
          email: `${randomBytes(8).toString('hex')}@example.invalid`,
          isActive: active,
          roles: [role.id],
        },
      })
  );
};
const createSource = async () => {
  const slug = `concurrent-${randomBytes(8).toString('hex')}`;
  return articleRecord.parse(
    await app()
      .documents('api::article.article')
      .create({ locale: 'en', data: { title: `Source ${slug}`, slug } })
  );
};
const translationRequest = (documentIds: string[]): TranslationRequest => ({
  contentType: 'api::article.article',
  documentIds,
  targetLocales: ['ar'],
  force: false,
});
const concurrentEnqueue = async (entries: { actorId: number; documentIds: string[] }[]) => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requests = entries.map(async ({ actorId, documentIds }) => {
    await gate;
    return translationRuntime().enqueue(
      translationRequest(documentIds),
      actorId,
      documentIds.length > 1 ? 'bulkTranslate' : 'translate'
    );
  });
  release();
  return Promise.allSettled(requests);
};
const activeJobs = async (documentIds: string[]) =>
  z.array(z.object({ id: z.number(), actorId: z.number(), entryDocumentId: z.string() })).parse(
    await app()
      .db.query('plugin::general-translation.job')
      .findMany({
        where: {
          entryDocumentId: { $in: documentIds },
          status: { $in: ['queued', 'running', 'waiting'] },
        },
      })
  );
const finishTranslation = async (id: number) =>
  expect
    .poll(
      async () => {
        await translationRuntime().worker.execute();
        const job = await translationRuntime().repository.get(id);
        if (job?.status === 'failed' || job?.status === 'conflict')
          throw new Error(JSON.stringify(job.error));
        return job?.status;
      },
      { timeout: 60_000, interval: 20 }
    )
    .toBe('succeeded');
const paidRequests = () =>
  runtime.mock?.requests.filter(
    (request) =>
      request.path === '/v2/translate' || request.path === '/v2/project/translations/enqueue'
  ).length ?? 0;

describe('atomic concurrent enqueue', () => {
  afterEach(async () => {
    await app()
      .db.query('plugin::general-translation.job')
      .deleteMany({ where: { status: { $in: ['queued', 'running', 'waiting'] } } });
  });
  it('deduplicates simultaneous requests from the same actor before one paid submission', async () => {
    const actor = await createEditor();
    const source = await createSource();
    const before = paidRequests();
    const results = await concurrentEnqueue(
      Array.from({ length: 6 }, () => ({ actorId: actor.id, documentIds: [source.documentId] }))
    );
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    const ids = results.flatMap((result) =>
      result.status === 'fulfilled' ? result.value.jobs.map((job) => job.id) : []
    );
    expect(new Set(ids).size).toBe(1);
    const jobs = await activeJobs([source.documentId]);
    expect(jobs).toHaveLength(1);
    const job = jobs[0];
    if (!job) throw new Error('No active job');
    expect(job.actorId).toBe(actor.id);
    await finishTranslation(job.id);
    expect(paidRequests() - before).toBe(1);
  });
  it('keeps one initiating actor when different editors enqueue simultaneously', async () => {
    const actors = await Promise.all([createEditor(), createEditor()]);
    const source = await createSource();
    const before = paidRequests();
    const entries = actors.flatMap((actor) =>
      Array.from({ length: 3 }, () => ({ actorId: actor.id, documentIds: [source.documentId] }))
    );
    const results = await concurrentEnqueue(entries);
    const jobs = await activeJobs([source.documentId]);
    expect(jobs).toHaveLength(1);
    const job = jobs[0];
    if (!job) throw new Error('No active job');
    for (const [index, result] of results.entries()) {
      expect(result.status).toBe(
        entries[index]?.actorId === job.actorId ? 'fulfilled' : 'rejected'
      );
      if (result.status === 'fulfilled') {
        expect(result.value.jobs.map((item) => item.id)).toEqual([job.id]);
        expect(result.value.jobs[0]).not.toHaveProperty('prepared');
        expect(result.value.jobs[0]).not.toHaveProperty('actorId');
      } else expect(JSON.stringify(result.reason)).not.toContain(source.title);
    }
    await finishTranslation(job.id);
    expect(paidRequests() - before).toBe(1);
    const target = await app()
      .documents('api::article.article')
      .findOne({
        documentId: source.documentId,
        locale: 'ar',
        status: 'draft',
        populate: ['createdBy', 'updatedBy'],
      });
    expect(
      z
        .object({
          createdBy: z.object({ id: z.number() }),
          updatedBy: z.object({ id: z.number() }),
        })
        .parse(target)
    ).toEqual({ createdBy: { id: job.actorId }, updatedBy: { id: job.actorId } });
  });
  it('rejects an unauthorized contender without disclosing or taking over the authorized job', async () => {
    const actor = await createEditor();
    const unauthorized = await createEditor(false);
    const source = await createSource();
    const results = await concurrentEnqueue([
      { actorId: actor.id, documentIds: [source.documentId] },
      { actorId: unauthorized.id, documentIds: [source.documentId] },
    ]);
    expect(results[0]?.status).toBe('fulfilled');
    expect(results[1]?.status).toBe('rejected');
    expect(await activeJobs([source.documentId])).toEqual([
      expect.objectContaining({ actorId: actor.id }),
    ]);
    const rejected = results[1];
    if (rejected?.status !== 'rejected') throw new Error('Unauthorized request was accepted');
    expect(rejected.reason).toMatchObject({ diagnostic: { code: 'permission-denied' } });
    expect(JSON.stringify(rejected.reason)).not.toContain(source.title);
  });
  it('deduplicates overlapping bulk selections submitted in opposite order', async () => {
    const actor = await createEditor();
    const sources = await Promise.all([createSource(), createSource()]);
    const ids = sources.map((source) => source.documentId);
    const before = paidRequests();
    const results = await concurrentEnqueue([
      { actorId: actor.id, documentIds: ids },
      { actorId: actor.id, documentIds: [...ids].reverse() },
    ]);
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    const jobs = await activeJobs(ids);
    expect(jobs).toHaveLength(2);
    for (const job of jobs) await finishTranslation(job.id);
    expect(paidRequests() - before).toBe(2);
  });
  it('rolls back the complete bulk batch when another actor owns an existing job', async () => {
    const owner = await createEditor();
    const contender = await createEditor();
    const sources = await Promise.all([createSource(), createSource()]);
    const first = sources[0];
    const second = sources[1];
    if (!first || !second) throw new Error('Missing bulk sources');
    await translationRuntime().enqueue(
      translationRequest([second.documentId]),
      owner.id,
      'translate'
    );
    const before = paidRequests();
    await expect(
      translationRuntime().enqueue(
        translationRequest([first.documentId, second.documentId]),
        contender.id,
        'bulkTranslate'
      )
    ).rejects.toMatchObject({ diagnostic: { code: 'validation' } });
    expect(await activeJobs([first.documentId])).toEqual([]);
    expect(await activeJobs([second.documentId])).toEqual([
      expect.objectContaining({ actorId: owner.id }),
    ]);
    expect(paidRequests()).toBe(before);
  });
  it('does not revive an older failed job while newer work owns the same document and locale', async () => {
    const actor = await createEditor();
    const source = await createSource();
    const service = translationRuntime();
    const first = await service.enqueue(
      translationRequest([source.documentId]),
      actor.id,
      'translate'
    );
    const failedId = first.jobs[0]?.id;
    if (!failedId || !runtime.mock) throw new Error('Missing queued job or mock');
    runtime.mock.failNext({ status: 400 });
    await service.worker.execute();
    expect(await service.repository.get(failedId)).toMatchObject({ status: 'failed' });
    const next = await service.enqueue(
      translationRequest([source.documentId]),
      actor.id,
      'translate'
    );
    const before = paidRequests();
    await expect(service.retry(failedId, actor.id)).rejects.toMatchObject({
      diagnostic: { code: 'validation' },
    });
    const jobs = await activeJobs([source.documentId]);
    expect(jobs.map((job) => job.id)).toEqual(next.jobs.map((job) => job.id));
    expect(await service.repository.get(failedId)).toMatchObject({ status: 'failed' });
    const job = jobs[0];
    if (!job) throw new Error('Missing active job');
    await finishTranslation(job.id);
    expect(paidRequests() - before).toBe(1);
  });
  it('serializes a retry racing a new enqueue without duplicate paid work', async () => {
    const actor = await createEditor();
    const source = await createSource();
    const service = translationRuntime();
    const first = await service.enqueue(
      translationRequest([source.documentId]),
      actor.id,
      'translate'
    );
    const failedId = first.jobs[0]?.id;
    if (!failedId || !runtime.mock) throw new Error('Missing queued job or mock');
    runtime.mock.failNext({ status: 400 });
    await service.worker.execute();
    expect(await service.repository.get(failedId)).toMatchObject({ status: 'failed' });
    const before = paidRequests();
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const requests = [
      async () => service.retry(failedId, actor.id),
      async () => service.enqueue(translationRequest([source.documentId]), actor.id, 'translate'),
    ].map(async (request) => {
      await gate;
      return request();
    });
    release();
    const results = await Promise.allSettled(requests);
    expect(results.some((result) => result.status === 'fulfilled')).toBe(true);
    const jobs = await activeJobs([source.documentId]);
    expect(jobs).toHaveLength(1);
    const job = jobs[0];
    if (!job) throw new Error('Missing active job');
    for (const result of results) {
      if (result.status === 'fulfilled')
        expect(result.value.jobs.map((item) => item.id)).toEqual([job.id]);
      else expect(result.reason).toMatchObject({ diagnostic: { code: 'validation' } });
    }
    await finishTranslation(job.id);
    expect(paidRequests() - before).toBe(1);
  });
});

const summaryTarget = z.object({
  documentId: z.string(),
  locale: z.string(),
  title: z.string(),
  slug: z.string(),
  summary: z.string().nullable(),
  editorialNote: z.string().nullable(),
  readingMinutes: z.number().nullable(),
});
const readSummaryTarget = async (documentId: string) =>
  summaryTarget.parse(
    await app()
      .documents('api::article.article')
      .findOne({ documentId, locale: 'ar', status: 'draft' })
  );
const writeSummary = async (documentId: string, locale: string, summary: string | null) => {
  const fields: Record<string, string | null> = { summary };
  await app().documents('api::article.article').update({ documentId, locale, data: fields });
};
const createSummaryTarget = async () => {
  const source = await createSource();
  const summary = `A populated matrix summary for ${source.documentId}`;
  await writeSummary(source.documentId, 'en', summary);
  const targetFields: Record<string, string | number | null> = {
    title: 'Keep the target title',
    slug: `target-${source.documentId}`,
    summary: null,
    editorialNote: 'Keep this manual note',
    readingMinutes: 47,
  };
  await app()
    .documents('api::article.article')
    .update({ documentId: source.documentId, locale: 'ar', data: targetFields });
  return { documentId: source.documentId, summary };
};
const enqueueSummary = async (documentId: string, actorId: number, force = false) => {
  const queued = await translationRuntime().enqueue(
    { ...translationRequest([documentId]), force },
    actorId,
    'translate'
  );
  const id = queued.jobs[0]?.id;
  if (id === undefined) throw new Error('No summary translation was queued');
  return id;
};

describe('null source clearing across database stores', () => {
  let originalSettings: PluginSettings | undefined;
  beforeAll(async () => {
    const service = translationRuntime();
    await service.worker.stop();
    originalSettings = await service.savedSettings();
    const article = originalSettings.contentTypes['api::article.article'];
    if (!article) throw new Error('The matrix article is not configured');
    await service.saveSettings({
      ...originalSettings,
      contentTypes: {
        ...originalSettings.contentTypes,
        'api::article.article': {
          ...article,
          fields: Object.fromEntries(
            Object.entries(article.fields).map(([name, rule]) => [
              name,
              { ...rule, translate: name === 'summary' },
            ])
          ),
        },
      },
    });
  });
  afterAll(async () => {
    if (originalSettings) await translationRuntime().saveSettings(originalSettings);
  });

  it('clears a machine-owned summary to null with no further paid requests', async () => {
    const actor = await createEditor();
    const source = await createSummaryTarget();
    await finishTranslation(await enqueueSummary(source.documentId, actor.id));
    const previous = await readSummaryTarget(source.documentId);
    expect(previous.summary).toBe(`[ar] ${source.summary}`);
    await writeSummary(source.documentId, 'en', null);
    expect(
      await app()
        .documents('api::article.article')
        .findOne({ documentId: source.documentId, locale: 'en', status: 'draft' })
    ).toMatchObject({ summary: null });
    const before = paidRequests();
    const id = await enqueueSummary(source.documentId, actor.id);
    await finishTranslation(id);
    expect(await translationRuntime().repository.get(id)).toMatchObject({ status: 'succeeded' });
    expect(await readSummaryTarget(source.documentId)).toEqual({ ...previous, summary: null });
    expect(paidRequests()).toBe(before);
  });

  it('protects a manually edited summary until forced null clearing without paid requests', async () => {
    const actor = await createEditor();
    const source = await createSummaryTarget();
    await finishTranslation(await enqueueSummary(source.documentId, actor.id));
    await writeSummary(source.documentId, 'ar', 'Keep this human summary');
    const previous = await readSummaryTarget(source.documentId);
    await writeSummary(source.documentId, 'en', null);
    const before = paidRequests();
    const protectedId = await enqueueSummary(source.documentId, actor.id);
    await translationRuntime().worker.execute();
    expect(await translationRuntime().repository.get(protectedId)).toMatchObject({
      status: 'conflict',
      error: { code: 'human-edit' },
    });
    expect(await readSummaryTarget(source.documentId)).toEqual(previous);
    expect(paidRequests()).toBe(before);
    const forcedId = await enqueueSummary(source.documentId, actor.id, true);
    await finishTranslation(forcedId);
    expect(await translationRuntime().repository.get(forcedId)).toMatchObject({
      status: 'succeeded',
    });
    expect(await readSummaryTarget(source.documentId)).toEqual({ ...previous, summary: null });
    expect(paidRequests()).toBe(before);
  });
});

const lifecycleRecord = articleRecord.extend({ slug: z.string(), summary: z.string().nullable() });
const readLifecycleDocument = async (
  documentId: string,
  locale: string,
  status: 'draft' | 'published' = 'draft'
) => {
  const found = await app()
    .documents('api::article.article')
    .findOne({ documentId, locale, status });
  return found === null ? null : lifecycleRecord.parse(found);
};
const createLifecycleSource = async () => {
  const created = await createSource();
  const summary = `Lifecycle source ${created.documentId}`;
  await writeSummary(created.documentId, 'en', summary);
  const otherFields: Record<string, string> = {
    title: 'Keep the other locale title',
    slug: `other-${created.documentId}`,
    summary: 'Keep the other locale manual summary',
  };
  await app()
    .documents('api::article.article')
    .update({ documentId: created.documentId, locale: 'fr', data: otherFields });
  return {
    documentId: created.documentId,
    source: lifecycleRecord.parse(await readLifecycleDocument(created.documentId, 'en')),
    otherLocale: lifecycleRecord.parse(await readLifecycleDocument(created.documentId, 'fr')),
  };
};
const protectHumanAfterRecovery = async (
  fixture: Awaited<ReturnType<typeof createLifecycleSource>>,
  actorId: number
) => {
  const published = await readLifecycleDocument(fixture.documentId, 'ar', 'published');
  await writeSummary(fixture.documentId, 'ar', 'Human summary after lifecycle recovery');
  const nextSource = `Changed after recovery ${fixture.documentId}`;
  await writeSummary(fixture.documentId, 'en', nextSource);
  const before = paidRequests();
  const id = await enqueueSummary(fixture.documentId, actorId);
  await translationRuntime().worker.execute();
  expect(await translationRuntime().repository.get(id)).toMatchObject({
    status: 'conflict',
    error: { code: 'human-edit' },
  });
  expect(await readLifecycleDocument(fixture.documentId, 'ar')).toMatchObject({
    summary: 'Human summary after lifecycle recovery',
  });
  expect(await readLifecycleDocument(fixture.documentId, 'ar', 'published')).toEqual(published);
  expect(await readLifecycleDocument(fixture.documentId, 'fr')).toEqual(fixture.otherLocale);
  expect(await readLifecycleDocument(fixture.documentId, 'en')).toMatchObject({
    title: fixture.source.title,
    slug: fixture.source.slug,
    summary: nextSource,
  });
  expect(paidRequests()).toBe(before);
};

describe('text checkpoint lifecycle with media translation disabled', () => {
  let originalSettings: PluginSettings | undefined;
  beforeAll(async () => {
    const service = translationRuntime();
    await service.worker.stop();
    originalSettings = await service.savedSettings();
    const article = originalSettings.contentTypes['api::article.article'];
    if (!article) throw new Error('The matrix article is not configured');
    await service.saveSettings({
      ...originalSettings,
      createMissingLocales: true,
      autoPublish: false,
      contentTypes: {
        ...originalSettings.contentTypes,
        'api::article.article': {
          ...article,
          mediaMetadata: false,
          fields: { ...article.fields, cover: { translate: false } },
        },
      },
    });
    expect(
      (await service.savedSettings()).contentTypes['api::article.article']?.mediaMetadata
    ).toBe(false);
  });
  afterAll(async () => {
    if (originalSettings) await translationRuntime().saveSettings(originalSettings);
  });

  it('recreates a deleted target without force while retaining source, other locale, and later human edits', async () => {
    const actor = await createEditor();
    const fixture = await createLifecycleSource();
    const service = translationRuntime();
    await finishTranslation(await enqueueSummary(fixture.documentId, actor.id));
    expect(await readLifecycleDocument(fixture.documentId, 'ar')).toMatchObject({
      summary: `[ar] ${fixture.source.summary}`,
    });
    expect(
      Object.keys(
        (await service.repository.state('api::article.article', fixture.documentId, 'ar', 'draft'))
          .checkpoints
      ).length
    ).toBeGreaterThan(0);
    await app()
      .documents('api::article.article')
      .delete({ documentId: fixture.documentId, locale: 'ar' });
    expect(await readLifecycleDocument(fixture.documentId, 'ar')).toBeNull();
    expect(await readLifecycleDocument(fixture.documentId, 'en')).toEqual(fixture.source);
    expect(await readLifecycleDocument(fixture.documentId, 'fr')).toEqual(fixture.otherLocale);
    const afterDeletion = await service.repository.state(
      'api::article.article',
      fixture.documentId,
      'ar',
      'draft'
    );
    const before = paidRequests();
    await finishTranslation(await enqueueSummary(fixture.documentId, actor.id));
    expect(afterDeletion.checkpoints).toEqual({});
    expect(await readLifecycleDocument(fixture.documentId, 'ar')).toMatchObject({
      summary: `[ar] ${fixture.source.summary}`,
    });
    expect(paidRequests() - before).toBe(1);
    expect(await readLifecycleDocument(fixture.documentId, 'en')).toEqual(fixture.source);
    expect(await readLifecycleDocument(fixture.documentId, 'fr')).toEqual(fixture.otherLocale);
    await protectHumanAfterRecovery(fixture, actor.id);
  });

  it('restores published checkpoints on discard and retranslates normally without weakening human protection', async () => {
    const actor = await createEditor();
    const fixture = await createLifecycleSource();
    const service = translationRuntime();
    await finishTranslation(await enqueueSummary(fixture.documentId, actor.id));
    const initialCheckpoint = (
      await service.repository.state('api::article.article', fixture.documentId, 'ar', 'draft')
    ).checkpoints;
    await publishWithAcknowledgement(fixture.documentId, 'ar');
    const published = lifecycleRecord.parse(
      await readLifecycleDocument(fixture.documentId, 'ar', 'published')
    );
    const publishedCheckpoint = (
      await service.repository.state('api::article.article', fixture.documentId, 'ar', 'published')
    ).checkpoints;
    const revisedSummary = `Revised source ${fixture.documentId}`;
    await writeSummary(fixture.documentId, 'en', revisedSummary);
    await finishTranslation(await enqueueSummary(fixture.documentId, actor.id));
    expect(await readLifecycleDocument(fixture.documentId, 'ar')).toMatchObject({
      summary: `[ar] ${revisedSummary}`,
    });
    expect(await readLifecycleDocument(fixture.documentId, 'ar', 'published')).toEqual(published);
    await app()
      .documents('api::article.article')
      .discardDraft({ documentId: fixture.documentId, locale: 'ar' });
    expect(await readLifecycleDocument(fixture.documentId, 'ar')).toMatchObject({
      summary: published.summary,
    });
    const afterDiscard = (
      await service.repository.state('api::article.article', fixture.documentId, 'ar', 'draft')
    ).checkpoints;
    const before = paidRequests();
    await finishTranslation(await enqueueSummary(fixture.documentId, actor.id));
    expect(publishedCheckpoint).toEqual(initialCheckpoint);
    expect(afterDiscard).toEqual(publishedCheckpoint);
    expect(await readLifecycleDocument(fixture.documentId, 'ar')).toMatchObject({
      summary: `[ar] ${revisedSummary}`,
    });
    expect(await readLifecycleDocument(fixture.documentId, 'ar', 'published')).toEqual(published);
    expect(await readLifecycleDocument(fixture.documentId, 'en')).toMatchObject({
      title: fixture.source.title,
      slug: fixture.source.slug,
      summary: revisedSummary,
    });
    expect(await readLifecycleDocument(fixture.documentId, 'fr')).toEqual(fixture.otherLocale);
    expect(paidRequests() - before).toBe(1);
    await protectHumanAfterRecovery(fixture, actor.id);
  });
});
