import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { PERMISSIONS, REQUEST_TIMEOUT_MS } from '../../shared/constants';
import { startStrapiFixture } from '../server/strapi-fixture';

vi.setConfig({ testTimeout: REQUEST_TIMEOUT_MS * 2, hookTimeout: REQUEST_TIMEOUT_MS * 4 });
const article = 'api::article.article';
let fixture: Awaited<ReturnType<typeof startStrapiFixture>> | undefined;
let sequence = 0;
const app = () => {
  if (!fixture) throw new Error('The UID permission fixture did not boot');
  return fixture;
};
beforeAll(async () => {
  fixture = await startStrapiFixture({ uid: true });
});
afterAll(async () => {
  if (fixture) await fixture.close();
});
beforeEach(async () => {
  await app().runtime.saveSettings({
    ...app().settings,
    contentTypes: {
      [article]: {
        mediaMetadata: false,
        fields: {
          title: { translate: false },
          slug: { translate: true, uidStrategy: 'regenerate' },
          summary: { translate: false },
          image: { translate: false },
        },
      },
    },
  });
});
afterEach(async () => {
  await app()
    .strapi.db.query('plugin::general-translation.job')
    .deleteMany({
      where: { status: { $in: ['queued', 'running', 'waiting'] } },
    });
});
const actor = async (sourceTitle: boolean, targetTitle: boolean, writeTitle = false) => {
  sequence += 1;
  const { strapi } = app();
  const role = z.object({ id: z.number() }).parse(
    await strapi.db.query('admin::role').create({
      data: { name: `UID editor ${sequence}`, code: `uid-editor-${sequence}` },
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
  for (const [locale, title] of [
    ['en', sourceTitle],
    ['fr', targetTitle],
  ] as const) {
    await strapi.db.query('admin::permission').create({
      data: {
        role: role.id,
        action: 'plugin::content-manager.explorer.read',
        subject: article,
        properties: { fields: ['slug', ...(title ? ['title'] : [])], locales: [locale] },
        conditions: [],
      },
    });
  }
  await strapi.db.query('admin::permission').create({
    data: {
      role: role.id,
      action: 'plugin::content-manager.explorer.update',
      subject: article,
      properties: { fields: ['slug', ...(writeTitle ? ['title'] : [])], locales: ['fr'] },
      conditions: [],
    },
  });
  const user = z.object({ id: z.number() }).parse(
    await strapi.db.query('admin::user').create({
      data: {
        firstname: 'UID',
        lastname: 'Editor',
        isActive: true,
        email: `uid-editor-${sequence}@example.invalid`,
        roles: [role.id],
      },
    })
  );
  return { id: user.id, roleId: role.id };
};
const document = async (targetTitle: string | null = 'Restricted target title') => {
  const { strapi, actorId } = app();
  sequence += 1;
  const source = z.object({ documentId: z.string() }).parse(
    await strapi.documents(article).create({
      locale: 'en',
      data: { title: 'Restricted source title', slug: `source-${sequence}`, createdBy: actorId },
    })
  );
  await strapi.documents(article).update({
    documentId: source.documentId,
    locale: 'fr',
    data: { title: targetTitle, slug: null, createdBy: actorId },
  });
  return source.documentId;
};
const enqueue = (documentId: string, actorId: number) =>
  app().runtime.enqueue(
    {
      contentType: article,
      documentIds: [documentId],
      targetLocales: ['fr'],
      force: false,
    },
    actorId,
    'translate'
  );
const target = (documentId: string) =>
  app().strapi.documents(article).findOne({
    documentId,
    locale: 'fr',
    status: 'draft',
  });

describe('real Strapi UID dependency permissions', () => {
  it.each([false, true])(
    'refuses an unreadable target title with source title Read %s',
    async (sourceRead) => {
      const editor = await actor(sourceRead, false);
      const id = await document();
      const requests = app().mock.requests.length;
      await expect(enqueue(id, editor.id)).rejects.toMatchObject({
        diagnostic: { code: 'permission-denied' },
      });
      expect(app().mock.requests).toHaveLength(requests);
      expect(await target(id)).toMatchObject({ title: 'Restricted target title', slug: null });
    }
  );
  it('allows target title Read with only slug Update and no source title Read', async () => {
    const editor = await actor(false, true);
    const id = await document('Readable target title');
    const requests = app().mock.requests.length;
    const queued = await enqueue(id, editor.id);
    const jobId = queued.jobs[0]?.id;
    if (!jobId) throw new Error('The allowed editor did not receive a job');
    await app().runtime.worker.execute();
    expect(await app().runtime.repository.get(jobId)).toMatchObject({ status: 'succeeded' });
    expect(await target(id)).toMatchObject({
      title: 'Readable target title',
      slug: 'readable-target-title',
    });
    expect(app().mock.requests).toHaveLength(requests);
  });
  it('denies translating a source title that the editor cannot read', async () => {
    const editor = await actor(false, true, true);
    const id = await document(null);
    const configured = await app().runtime.settings();
    const fields = configured.settings.contentTypes[article]?.fields;
    if (!fields) throw new Error('The article settings are missing');
    fields.title = { translate: true };
    await app().runtime.saveSettings(configured.settings);
    const requests = app().mock.requests.length;
    await expect(enqueue(id, editor.id)).rejects.toMatchObject({
      diagnostic: { code: 'permission-denied' },
    });
    expect(app().mock.requests).toHaveLength(requests);
    expect(await target(id)).toMatchObject({ title: null, slug: null });
  });
  it('rechecks target title Read before applying a queued slug', async () => {
    const editor = await actor(false, true);
    const id = await document();
    const queued = await enqueue(id, editor.id);
    const jobId = queued.jobs[0]?.id;
    if (!jobId) throw new Error('The allowed editor did not receive a job');
    const restricted = await actor(false, false);
    await app()
      .strapi.db.query('admin::user')
      .update({
        where: { id: editor.id },
        data: { roles: [restricted.roleId] },
      });
    const requests = app().mock.requests.length;
    await app().runtime.worker.execute();
    expect(await app().runtime.repository.get(jobId)).toMatchObject({
      status: 'failed',
      error: { code: 'permission-denied' },
    });
    expect(await target(id)).toMatchObject({ title: 'Restricted target title', slug: null });
    expect(app().mock.requests).toHaveLength(requests);
  });
});
