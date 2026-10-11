import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { startStrapiFixture } from './strapi-fixture';
import { PERMISSIONS, REQUEST_TIMEOUT_MS } from '../../shared/constants';

vi.setConfig({ testTimeout: REQUEST_TIMEOUT_MS * 2, hookTimeout: REQUEST_TIMEOUT_MS * 4 });
let fixture: Awaited<ReturnType<typeof startStrapiFixture>> | undefined;
let sequence = 0;
const app = () => {
  if (!fixture) throw new Error('The lifecycle fixture did not boot');
  return fixture;
};
type Model = 'api::article.article' | 'api::note.note';
const article: Model = 'api::article.article';
const note: Model = 'api::note.note';
const settings = (mediaMetadata = false) => ({
  ...app().settings,
  targetLocales: ['fr', 'ar'],
  contentTypes: Object.fromEntries(
    [article, note].map((uid) => [
      uid,
      {
        mediaMetadata,
        fields: {
          title: { translate: true },
          summary: { translate: true },
          image: { translate: mediaMetadata },
        },
      },
    ])
  ),
});
beforeAll(async () => {
  fixture = await startStrapiFixture();
});
beforeEach(async () => {
  await app().runtime.saveSettings(settings());
});
afterEach(async () => {
  vi.restoreAllMocks();
  await app()
    .strapi.db.query('plugin::general-translation.job')
    .deleteMany({ where: { status: { $in: ['queued', 'running', 'waiting'] } } });
});
afterAll(async () => {
  if (fixture) await fixture.close();
});
const source = async (model: Model = article) => {
  sequence += 1;
  return z.object({ documentId: z.string() }).parse(
    await app()
      .strapi.documents(model)
      .create({
        locale: 'en',
        data: {
          title: `Lifecycle ${sequence}`,
          summary: 'First source',
          image: app().assetId,
          createdBy: app().actorId,
          updatedBy: app().actorId,
        },
      })
  ).documentId;
};
const read = (
  documentId: string,
  locale = 'fr',
  status: 'draft' | 'published' = 'draft',
  model: Model = article
) => app().strapi.documents(model).findOne({ documentId, locale, status });
const state = (
  documentId: string,
  locale = 'fr',
  status: 'draft' | 'published' = 'draft',
  model: Model = article
) => app().runtime.repository.state(model, documentId, locale, status);
const empty = { checkpoints: {}, media: [], appliedJob: null };
const translate = async (
  documentId: string,
  locale = 'fr',
  model: Model = article,
  actorId = app().actorId
) => {
  const { runtime } = app();
  const response = await runtime.enqueue(
    { contentType: model, documentIds: [documentId], targetLocales: [locale], force: false },
    actorId,
    'translate'
  );
  const id = response.jobs[0]?.id;
  if (!id) throw new Error('Missing lifecycle job');
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const job = await runtime.repository.get(id);
    if (job && ['succeeded', 'failed', 'conflict'].includes(job.status)) return job;
    await runtime.worker.execute();
  }
  throw new Error('Lifecycle job did not finish');
};
const translated = async (documentId: string, locale = 'fr', model: Model = article) => {
  const job = await translate(documentId, locale, model);
  expect(job.status, JSON.stringify(job.error)).toBe('succeeded');
  return job;
};
const updateText = (documentId: string, locale: string, data: Record<string, string>) =>
  app().strapi.documents(article).update({ documentId, locale, data });
const revise = (documentId: string, summary = 'Revised source') =>
  updateText(documentId, 'en', { summary });
const restrictedActor = async (create: boolean) => {
  sequence += 1;
  const role = z.object({ id: z.number() }).parse(
    await app()
      .strapi.db.query('admin::role')
      .create({
        data: { name: `Lifecycle editor ${sequence}`, code: `lifecycle-editor-${sequence}` },
      })
  );
  await app()
    .strapi.db.query('admin::permission')
    .create({
      data: {
        role: role.id,
        action: PERMISSIONS.translate,
        subject: null,
        properties: {},
        conditions: [],
      },
    });
  for (const action of ['read', 'update', ...(create ? ['create'] : [])]) {
    await app()
      .strapi.db.query('admin::permission')
      .create({
        data: {
          role: role.id,
          action: `plugin::content-manager.explorer.${action}`,
          subject: article,
          properties: {
            fields: ['title', 'summary', 'image'],
            locales: action === 'read' ? ['en', 'fr'] : ['fr'],
          },
          conditions: [],
        },
      });
  }
  return z.object({ id: z.number() }).parse(
    await app()
      .strapi.db.query('admin::user')
      .create({
        data: {
          firstname: 'Lifecycle',
          lastname: 'Editor',
          email: `lifecycle-${sequence}@example.invalid`,
          isActive: true,
          roles: [role.id],
        },
      })
  ).id;
};

describe('ordinary translation state with media disabled', () => {
  it.each([article, note])(
    'deletes checkpoints before recreating a translated locale for %s',
    async (model) => {
      const id = await source(model);
      await translated(id, 'fr', model);
      expect(
        Object.keys((await state(id, 'fr', 'draft', model)).checkpoints).length
      ).toBeGreaterThan(0);
      await app().strapi.documents(model).delete({ documentId: id, locale: 'fr' });
      expect(await state(id, 'fr', 'draft', model)).toEqual(empty);
      expect(await state(id, 'fr', 'published', model)).toEqual(empty);
      await translated(id, 'fr', model);
      expect(await read(id, 'fr', 'draft', model)).toMatchObject({ summary: '[fr] First source' });
    }
  );
  it('copies ordinary checkpoints on publication', async () => {
    const id = await source();
    await translated(id);
    const draft = await state(id);
    await app().strapi.documents(article).publish({ documentId: id, locale: 'fr' });
    expect(await state(id, 'fr', 'published')).toEqual(draft);
    expect(await read(id, 'fr', 'published')).toMatchObject({ summary: '[fr] First source' });
  });
  it('restores published checkpoints when a newer machine draft is discarded', async () => {
    const id = await source();
    await translated(id);
    const published = await state(id);
    await app().strapi.documents(article).publish({ documentId: id, locale: 'fr' });
    await revise(id);
    await translated(id);
    expect(await read(id)).toMatchObject({ summary: '[fr] Revised source' });
    await app().strapi.documents(article).discardDraft({ documentId: id, locale: 'fr' });
    expect(await read(id)).toMatchObject({ summary: '[fr] First source' });
    expect(await state(id)).toEqual(published);
    await translated(id);
    expect(await read(id)).toMatchObject({ summary: '[fr] Revised source' });
  });
  it('unpublishes only the published checkpoint snapshot', async () => {
    await app().runtime.saveSettings({ ...settings(), autoPublish: true });
    const id = await source();
    await translated(id);
    await app().strapi.documents(article).publish({ documentId: id, locale: 'fr' });
    const draft = await state(id);
    await app().strapi.documents(article).unpublish({ documentId: id, locale: 'fr' });
    expect(await state(id)).toEqual(draft);
    expect(await state(id, 'fr', 'published')).toEqual(empty);
    expect(await read(id, 'fr', 'published')).toBeNull();
  });
  it('keeps another locale checkpoint when one locale is deleted', async () => {
    const id = await source();
    await translated(id, 'fr');
    await translated(id, 'ar');
    const arabic = await state(id, 'ar');
    await app().strapi.documents(article).delete({ documentId: id, locale: 'fr' });
    expect(await state(id)).toEqual(empty);
    expect(await state(id, 'ar')).toEqual(arabic);
    expect(await read(id, 'ar')).toMatchObject({ summary: '[ar] First source' });
  });
  it('publishes and unpublishes all returned locales for locale:*', async () => {
    const id = await source();
    await translated(id, 'fr');
    await translated(id, 'ar');
    await app().strapi.documents(article).publish({ documentId: id, locale: '*' });
    for (const locale of ['fr', 'ar'])
      expect(await state(id, locale, 'published')).toEqual(await state(id, locale));
    await app().strapi.documents(article).unpublish({ documentId: id, locale: '*' });
    for (const locale of ['fr', 'ar']) {
      expect(await state(id, locale, 'published')).toEqual(empty);
      expect(Object.keys((await state(id, locale)).checkpoints).length).toBeGreaterThan(0);
    }
  });
  it('deletes all locale snapshots while preserving another document', async () => {
    const id = await source();
    const other = await source();
    await translated(id, 'fr');
    await translated(id, 'ar');
    await translated(other);
    const otherState = await state(other);
    await app().strapi.documents(article).publish({ documentId: id, locale: '*' });
    await app().strapi.documents(article).delete({ documentId: id, locale: '*' });
    for (const locale of ['en', 'fr', 'ar'])
      for (const variant of ['draft', 'published'] as const)
        expect(await state(id, locale, variant)).toEqual(empty);
    expect(await state(other)).toEqual(otherState);
  });
  it('retains native unavailability of publication operations on non-DP content', async () => {
    const id = await source(note);
    await translated(id, 'fr', note);
    const before = await state(id, 'fr', 'published', note);
    expect(app().strapi.documents(note).publish).toBeUndefined();
    expect(await state(id, 'fr', 'published', note)).toEqual(before);
  });
  it('preserves a genuine human value across publish and discard', async () => {
    const id = await source();
    await translated(id);
    await updateText(id, 'fr', { summary: 'Human published value' });
    await app().strapi.documents(article).publish({ documentId: id, locale: 'fr' });
    await updateText(id, 'fr', { summary: 'Temporary draft' });
    await app().strapi.documents(article).discardDraft({ documentId: id, locale: 'fr' });
    await revise(id);
    const job = await translate(id);
    expect(job.status).toBe('conflict');
    expect(job.error?.code).toBe('human-edit');
    expect(await read(id)).toMatchObject({ summary: 'Human published value' });
  });
});

it.each([false, true])(
  'maintains state while media changes from %s to its opposite',
  async (initial) => {
    await app().runtime.saveSettings(settings(initial));
    const id = await source();
    await translated(id);
    const draft = await state(id);
    expect(draft.media.length > 0).toBe(initial);
    await app().runtime.saveSettings(settings(!initial));
    await app().strapi.documents(article).publish({ documentId: id, locale: 'fr' });
    expect(await state(id, 'fr', 'published')).toEqual(draft);
    await app().strapi.documents(article).delete({ documentId: id, locale: 'fr' });
    expect(await state(id)).toEqual(empty);
    expect(await state(id, 'fr', 'published')).toEqual(empty);
    expect(
      await app()
        .strapi.db.query('plugin::upload.file')
        .findOne({ where: { id: app().assetId } })
    ).toMatchObject({ alternativeText: 'Clouds', caption: 'Blue sky' });
  }
);
it('recovers a missing locale deleted while its content type was disabled', async () => {
  const id = await source();
  await translated(id);
  const previous = await state(id);
  await app().runtime.saveSettings({ ...settings(), contentTypes: {} });
  await app().strapi.documents(article).delete({ documentId: id, locale: 'fr' });
  expect(await state(id)).toEqual(previous);
  await app().runtime.saveSettings(settings());
  await translated(id);
  expect(await read(id)).toMatchObject({ summary: '[fr] First source' });
});
it.each(['Human recreation', ''])(
  'preserves an existing manually recreated locale with value %j',
  async (summary) => {
    const id = await source();
    await translated(id);
    await app().runtime.saveSettings({ ...settings(), contentTypes: {} });
    await app().strapi.documents(article).delete({ documentId: id, locale: 'fr' });
    await updateText(id, 'fr', { title: 'Human title', summary });
    await app().runtime.saveSettings(settings());
    const job = await translate(id);
    expect(job.status).toBe('conflict');
    expect(job.error?.code).toBe('human-edit');
    expect(await read(id)).toMatchObject({ title: 'Human title', summary });
  }
);
it('still requires create permission when an absent locale has stale checkpoints', async () => {
  const id = await source();
  await translated(id);
  await app().runtime.saveSettings({ ...settings(), contentTypes: {} });
  await app().strapi.documents(article).delete({ documentId: id, locale: 'fr' });
  await app().runtime.saveSettings(settings());
  const actor = await restrictedActor(false);
  const before = app().mock.requests.length;
  await expect(translate(id, 'fr', article, actor)).rejects.toMatchObject({
    diagnostic: { code: 'permission-denied' },
  });
  expect(app().mock.requests).toHaveLength(before);
  expect(await read(id)).toBeNull();
});
it('does not create or publish a locale without publish permission', async () => {
  const id = await source();
  await app().runtime.saveSettings({ ...settings(), autoPublish: true });
  const actor = await restrictedActor(true);
  const before = app().mock.requests.length;
  await expect(translate(id, 'fr', article, actor)).rejects.toMatchObject({
    diagnostic: { code: 'permission-denied' },
  });
  expect(app().mock.requests).toHaveLength(before);
  expect(await read(id)).toBeNull();
});
it('rolls back publication if checkpoint synchronization fails', async () => {
  const id = await source();
  await translated(id);
  const draft = await state(id);
  vi.spyOn(app().runtime.repository, 'saveState').mockRejectedValueOnce(
    new Error('Synthetic state failure')
  );
  await expect(
    app().strapi.documents(article).publish({ documentId: id, locale: 'fr' })
  ).rejects.toThrow('Synthetic state failure');
  expect(await read(id, 'fr', 'published')).toBeNull();
  expect(await state(id)).toEqual(draft);
  expect(await state(id, 'fr', 'published')).toEqual(empty);
});
it.each(['delete', 'unpublish'] as const)(
  'rolls back %s if state deletion fails',
  async (operation) => {
    const id = await source();
    await translated(id);
    await app().strapi.documents(article).publish({ documentId: id, locale: 'fr' });
    const before = await state(id);
    vi.spyOn(app().runtime.repository, 'deleteState').mockRejectedValueOnce(
      new Error('Synthetic state failure')
    );
    await expect(
      operation === 'delete'
        ? app().strapi.documents(article).delete({ documentId: id, locale: 'fr' })
        : app().strapi.documents(article).unpublish({ documentId: id, locale: 'fr' })
    ).rejects.toThrow('Synthetic state failure');
    expect(await read(id, 'fr', 'published')).toMatchObject({ summary: '[fr] First source' });
    expect(await state(id)).toEqual(before);
  }
);
