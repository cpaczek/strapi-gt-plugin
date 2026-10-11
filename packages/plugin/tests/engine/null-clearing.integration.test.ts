import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { hashValue } from '../../server/src/engine';
import { PERMISSIONS, REQUEST_TIMEOUT_MS } from '../../shared/constants';
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
  const created = z.object({ documentId: z.string() }).parse(
    await strapi.documents('api::article.article').create({
      locale: 'en',
      data: {
        title: `Null clearing ${sequence}`,
        summary: 'Source summary',
        createdBy: actorId,
        updatedBy: actorId,
      },
    })
  );
  await strapi.documents('api::article.article').update({
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

it('clears a native nested optional string without changing component identity or manual nontext data', async () => {
  const { strapi, runtime, settings } = app();
  const documentId = await source();
  await runtime.saveSettings({
    ...settings,
    contentTypes: {
      'api::article.article': {
        mediaMetadata: false,
        fields: {
          title: { translate: false },
          summary: { translate: false },
          image: { translate: false },
          card: { translate: true },
          cards: { translate: false },
          sections: { translate: false },
        },
      },
    },
  });
  await strapi
    .documents('api::article.article')
    .update({ documentId, locale: 'en', data: { card: { title: 'Nested source', count: 7 } } });
  expect(await translate(documentId)).toMatchObject({ status: 'succeeded' });
  const cardRecord = z.object({
    card: z.object({ id: z.number(), title: z.string().nullable(), count: z.number() }),
  });
  const read = (locale: string) =>
    strapi
      .documents('api::article.article')
      .findOne({ documentId, locale, status: 'draft', populate: { card: true } });
  const sourceCard = cardRecord.parse(await read('en')).card;
  const targetCard = cardRecord.parse(await read('fr')).card;
  await strapi
    .documents('api::article.article')
    .update({ documentId, locale: 'fr', data: { card: { ...targetCard, count: 999 } } });
  await strapi
    .documents('api::article.article')
    .update({ documentId, locale: 'en', data: { card: { ...sourceCard, title: null } } });
  const count = app().mock.requests.length;
  expect(await translate(documentId)).toMatchObject({ status: 'succeeded' });
  expect(cardRecord.parse(await read('fr')).card).toEqual({
    id: targetCard.id,
    title: null,
    count: 999,
  });
  expect(app().mock.requests).toHaveLength(count);
});

it('suppresses a stale published caption after raw metadata becomes null while retaining a valid human alt overlay', async () => {
  const { strapi, runtime, settings, assetId, actorId } = app();
  const documentId = await source();
  await runtime.saveSettings(settings);
  for (const locale of ['en', 'fr'])
    await strapi
      .documents('api::article.article')
      .update({ documentId, locale, data: { image: assetId } });
  expect(await translate(documentId)).toMatchObject({ status: 'succeeded' });
  await runtime.mediaDocument('api::article.article', documentId, 'fr', 'draft', actorId, {
    contentType: 'api::article.article',
    documentId,
    locale: 'fr',
    path: ['image'],
    property: 'alternativeText',
    value: 'Human alt text',
    reset: false,
  });
  await strapi.documents('api::article.article').publish({ documentId, locale: 'fr' });
  const count = app().mock.requests.length;
  await strapi.db
    .query('plugin::upload.file')
    .update({ where: { id: assetId }, data: { caption: null } });
  const raw = await strapi
    .documents('api::article.article')
    .findOne({ documentId, locale: 'fr', status: 'published', populate: { image: true } });
  const metadata = await runtime.metadata();
  const schema = metadata.contentTypes.find((entry) => entry.uid === 'api::article.article');
  if (!schema) throw new Error('The article schema is unavailable');
  expect(
    await runtime.media.decorate(raw, schema, metadata.components, settings, true)
  ).toMatchObject({ image: { caption: null, alternativeText: 'Human alt text' } });
  const state = await runtime.repository.state(
    'api::article.article',
    documentId,
    'fr',
    'published'
  );
  expect(state.media.find((entry) => entry.property === 'alternativeText')).toMatchObject({
    origin: 'manual',
    value: 'Human alt text',
  });
  expect(state.media.find((entry) => entry.property === 'caption')?.value).toBe('[fr] Blue sky');
  expect(app().mock.requests).toHaveLength(count);
});

it('requires update permission for a local-only null patch even though it has no remote segments', async () => {
  const { strapi, runtime } = app();
  const documentId = await source();
  expect(await translate(documentId)).toMatchObject({ status: 'succeeded' });
  await clearSource(documentId);
  const role = z.object({ id: z.number() }).parse(
    await strapi.db.query('admin::role').create({
      data: {
        name: 'Null clear denied',
        code: 'null-clear-denied',
        description: 'No summary update grant',
      },
    })
  );
  await strapi.db.query('admin::permission').create({
    data: {
      role: role.id,
      action: PERMISSIONS.translate,
      subject: null,
      properties: {},
      conditions: [],
    },
  });
  for (const action of ['read', 'update'])
    await strapi.db.query('admin::permission').create({
      data: {
        role: role.id,
        action: `plugin::content-manager.explorer.${action}`,
        subject: 'api::article.article',
        properties: {
          fields: action === 'read' ? ['title', 'summary'] : ['title'],
          locales: ['en', 'fr'],
        },
        conditions: [],
      },
    });
  const actor = z.object({ id: z.number() }).parse(
    await strapi.db.query('admin::user').create({
      data: {
        firstname: 'Limited',
        lastname: 'Null clear',
        email: 'null-clear-denied@example.invalid',
        isActive: true,
        roles: [role.id],
      },
    })
  );
  const count = app().mock.requests.length;
  await expect(
    runtime.enqueue(
      {
        contentType: 'api::article.article',
        documentIds: [documentId],
        targetLocales: ['fr'],
        force: true,
      },
      actor.id,
      'translate'
    )
  ).rejects.toMatchObject({ diagnostic: { code: 'permission-denied' } });
  expect(await readTarget(documentId)).toMatchObject({ summary: '[fr] Source summary' });
  expect(app().mock.requests).toHaveLength(count);
});
