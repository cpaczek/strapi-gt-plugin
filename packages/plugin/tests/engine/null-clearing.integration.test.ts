import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { hashValue } from '../../server/src/engine';
import { REQUEST_TIMEOUT_MS } from '../../shared/constants';
import { startStrapiFixture } from '../server/strapi-fixture';

vi.setConfig({ testTimeout: REQUEST_TIMEOUT_MS * 2, hookTimeout: REQUEST_TIMEOUT_MS * 4 });
let fixture: Awaited<ReturnType<typeof startStrapiFixture>> | undefined;
let sequence = 0;
const app = () => {
  if (!fixture) throw new Error('The null-clearing fixture did not boot');
  return fixture;
};
beforeAll(async () => {
  fixture = await startStrapiFixture();
});
afterAll(async () => {
  if (fixture) await fixture.close();
});
beforeEach(async () => {
  const { runtime, settings } = app();
  await runtime.saveSettings({
    ...settings,
    contentTypes: {
      'api::article.article': {
        mediaMetadata: false,
        fields: {
          title: { translate: false },
          summary: { translate: true },
          image: { translate: false },
          card: { translate: false },
          cards: { translate: false },
          sections: { translate: false },
        },
      },
    },
  });
});
const source = async () => {
  const { strapi, actorId } = app();
  sequence += 1;
  const created = z
    .object({ documentId: z.string() })
    .parse(
      await strapi
        .documents('api::article.article')
        .create({
          locale: 'en',
          data: {
            title: `Null clearing ${sequence}`,
            summary: 'Source summary',
            createdBy: actorId,
            updatedBy: actorId,
          },
        })
    );
  await strapi
    .documents('api::article.article')
    .update({
      documentId: created.documentId,
      locale: 'fr',
      data: { title: 'Human locale title', summary: null },
    });
  return created.documentId;
};
const translate = async (documentId: string, force = false) => {
  const { runtime, actorId } = app();
  const queued = await runtime.enqueue(
    {
      contentType: 'api::article.article',
      documentIds: [documentId],
      targetLocales: ['fr'],
      force,
    },
    actorId,
    'translate'
  );
  const id = queued.jobs[0]?.id;
  if (!id) throw new Error('No null-clearing translation job was created');
  for (let step = 0; step < 8; step += 1) {
    const job = await runtime.repository.get(id);
    if (job && ['succeeded', 'failed', 'conflict'].includes(job.status)) return job;
    await runtime.worker.execute();
  }
  throw new Error('The null-clearing job did not finish');
};
const readTarget = (documentId: string) =>
  app()
    .strapi.documents('api::article.article')
    .findOne({ documentId, locale: 'fr', status: 'draft' });
const clearSource = async (documentId: string) => {
  const { strapi } = app();
  await strapi
    .documents('api::article.article')
    .update({ documentId, locale: 'en', data: { summary: null } });
  expect(
    await strapi.documents('api::article.article').findOne({ documentId, locale: 'en' })
  ).toMatchObject({ summary: null });
};

describe('real Document Service null clearing', () => {
  it('clears a previous machine translation with no new GT calls and remains idempotent', async () => {
    const documentId = await source();
    expect(await translate(documentId)).toMatchObject({ status: 'succeeded' });
    expect(await readTarget(documentId)).toMatchObject({ summary: '[fr] Source summary' });
    await clearSource(documentId);
    const count = app().mock.requests.length;
    expect(await translate(documentId)).toMatchObject({ status: 'succeeded' });
    expect(await readTarget(documentId)).toMatchObject({
      title: 'Human locale title',
      summary: null,
    });
    const state = await app().runtime.repository.state(
      'api::article.article',
      documentId,
      'fr',
      'draft'
    );
    expect(state.checkpoints['["summary"]']?.targetHash).toBe(hashValue(null));
    expect(await translate(documentId)).toMatchObject({ status: 'succeeded' });
    expect(app().mock.requests).toHaveLength(count);
  });
  it('protects edits made after machine translation, then clears only with explicit force', async () => {
    const documentId = await source();
    await translate(documentId);
    await app()
      .strapi.documents('api::article.article')
      .update({ documentId, locale: 'fr', data: { summary: 'Human edited summary' } });
    await clearSource(documentId);
    const count = app().mock.requests.length;
    expect(await translate(documentId)).toMatchObject({
      status: 'conflict',
      error: { code: 'human-edit' },
    });
    expect(await readTarget(documentId)).toMatchObject({ summary: 'Human edited summary' });
    expect(await translate(documentId, true)).toMatchObject({ status: 'succeeded' });
    expect(await readTarget(documentId)).toMatchObject({ summary: null });
    expect(app().mock.requests).toHaveLength(count);
  });
  it('protects preexisting manual text before the first job and permits forced null clearing', async () => {
    const documentId = await source();
    await app()
      .strapi.documents('api::article.article')
      .update({ documentId, locale: 'fr', data: { summary: 'Before any translation' } });
    await clearSource(documentId);
    const count = app().mock.requests.length;
    expect(await translate(documentId)).toMatchObject({
      status: 'conflict',
      error: { code: 'human-edit' },
    });
    expect(await translate(documentId, true)).toMatchObject({ status: 'succeeded' });
    expect(await readTarget(documentId)).toMatchObject({ summary: null });
    expect(app().mock.requests).toHaveLength(count);
  });
});
