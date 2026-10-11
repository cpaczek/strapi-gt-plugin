import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { objectRecord } from '../../server/src/validation';
import { PERMISSIONS, REQUEST_TIMEOUT_MS } from '../../shared/constants';
import { fixtureDocumentData, startStrapiFixture } from '../server/strapi-fixture';

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
      data: fixtureDocumentData({
        title: 'Restricted source title',
        slug: `source-${sequence}`,
        createdBy: actorId,
      }),
    })
  );
  await strapi.documents(article).update({
    documentId: source.documentId,
    locale: 'fr',
    data: fixtureDocumentData({ title: targetTitle, slug: null, createdBy: actorId }),
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

it('uses newly translated source text without requiring target title Read', async () => {
  const editor = await actor(true, false, true);
  const id = await document(null);
  const configured = await app().runtime.savedSettings();
  const fields = configured.contentTypes[article]?.fields;
  if (!fields) throw new Error('The article settings are missing');
  fields.title = { translate: true };
  await app().runtime.saveSettings(configured);
  const queued = await enqueue(id, editor.id);
  const jobId = queued.jobs[0]?.id;
  if (!jobId) throw new Error('The allowed editor did not receive a job');
  await app().runtime.worker.execute();
  await app().runtime.worker.execute();
  expect(await app().runtime.repository.get(jobId)).toMatchObject({ status: 'succeeded' });
  expect(await target(id)).toMatchObject({
    title: '[fr] Restricted source title',
    slug: 'fr-restricted-source-title',
  });
});

it.each(['en', 'fr'])(
  'rejects changed %s dependency content before writing a queued slug',
  async (locale) => {
    const editor = await actor(true, true);
    const id = await document();
    const queued = await enqueue(id, editor.id);
    const jobId = queued.jobs[0]?.id;
    if (!jobId) throw new Error('The allowed editor did not receive a job');
    await app()
      .strapi.documents(article)
      .update({
        documentId: id,
        locale,
        data: fixtureDocumentData({ title: 'Changed while queued' }),
      });
    const requests = app().mock.requests.length;
    await app().runtime.worker.execute();
    expect(await app().runtime.repository.get(jobId)).toMatchObject({
      status: 'conflict',
      error: { code: locale === 'en' ? 'stale-source' : 'human-edit' },
    });
    expect(await target(id)).toMatchObject({
      title: locale === 'fr' ? 'Changed while queued' : 'Restricted target title',
      slug: null,
    });
    expect(app().mock.requests).toHaveLength(requests);
  }
);

it('rejects changing the UID source field while a job is queued', async () => {
  const editor = await actor(false, true);
  const id = await document();
  const queued = await enqueue(id, editor.id);
  const jobId = queued.jobs[0]?.id;
  if (!jobId) throw new Error('The allowed editor did not receive a job');
  const settings = await app().runtime.savedSettings();
  const fields = settings.contentTypes[article]?.fields;
  if (!fields) throw new Error('The article settings are missing');
  fields.slug = { translate: true, uidStrategy: 'regenerate', sourceField: 'summary' };
  await app().runtime.saveSettings(settings);
  const requests = app().mock.requests.length;
  await app().runtime.worker.execute();
  expect(await app().runtime.repository.get(jobId)).toMatchObject({
    status: 'failed',
    error: { code: 'validation' },
  });
  expect(await target(id)).toMatchObject({ title: 'Restricted target title', slug: null });
  expect(app().mock.requests).toHaveLength(requests);
});

it('rejects a UID dependency made private after enqueue', async () => {
  const editor = await actor(false, true);
  const id = await document();
  const queued = await enqueue(id, editor.id);
  const jobId = queued.jobs[0]?.id;
  if (!jobId) throw new Error('The allowed editor did not receive a job');
  const schema = app().strapi.contentTypes[article];
  if (!schema) throw new Error('The real article schema is unavailable');
  const attributes: unknown = schema.attributes;
  if (!objectRecord(attributes) || !objectRecord(attributes.title))
    throw new Error('The real title schema is unavailable');
  const title = attributes.title;
  const previous = Object.getOwnPropertyDescriptor(title, 'private');
  Object.defineProperty(title, 'private', {
    value: true,
    writable: true,
    configurable: true,
    enumerable: true,
  });
  const requests = app().mock.requests.length;
  try {
    await app().runtime.worker.execute();
    expect(await app().runtime.repository.get(jobId)).toMatchObject({
      status: 'failed',
      error: { code: 'validation' },
    });
    expect(await target(id)).toMatchObject({ title: 'Restricted target title', slug: null });
    expect(app().mock.requests).toHaveLength(requests);
  } finally {
    if (previous) Object.defineProperty(title, 'private', previous);
    else Reflect.deleteProperty(title, 'private');
  }
});

it('denies reading a UID dependency in a forbidden target locale', async () => {
  const editor = await actor(true, true);
  const id = await document();
  const permissions = z
    .array(z.object({ id: z.number(), properties: z.object({ locales: z.array(z.string()) }) }))
    .parse(
      await app()
        .strapi.db.query('admin::permission')
        .findMany({
          where: { role: editor.roleId, action: 'plugin::content-manager.explorer.read' },
        })
    );
  for (const permission of permissions.filter((permission) =>
    permission.properties.locales.includes('fr')
  )) {
    await app()
      .strapi.db.query('admin::permission')
      .delete({ where: { id: permission.id } });
  }
  const requests = app().mock.requests.length;
  await expect(enqueue(id, editor.id)).rejects.toMatchObject({
    diagnostic: { code: 'permission-denied' },
  });
  expect(await target(id)).toMatchObject({ slug: null });
  expect(app().mock.requests).toHaveLength(requests);
});

it('copies a UID without requiring Read on an unused target title', async () => {
  const editor = await actor(false, false);
  const id = await document();
  const settings = await app().runtime.savedSettings();
  const fields = settings.contentTypes[article]?.fields;
  if (!fields) throw new Error('The article settings are missing');
  fields.slug = { translate: true, uidStrategy: 'copy' };
  await app().runtime.saveSettings(settings);
  const source = z
    .object({ slug: z.string() })
    .parse(await app().strapi.documents(article).findOne({ documentId: id, locale: 'en' }));
  const requests = app().mock.requests.length;
  const queued = await enqueue(id, editor.id);
  const jobId = queued.jobs[0]?.id;
  if (!jobId) throw new Error('The allowed editor did not receive a job');
  await app().runtime.worker.execute();
  expect(await app().runtime.repository.get(jobId)).toMatchObject({ status: 'succeeded' });
  expect(await target(id)).toMatchObject({ title: 'Restricted target title', slug: source.slug });
  expect(app().mock.requests).toHaveLength(requests);
});

it('does not reread an unchanged UID dependency after a permitted translation', async () => {
  const allowed = await actor(false, true);
  const deniedTitle = await actor(false, false);
  const id = await document();
  const first = await enqueue(id, allowed.id);
  const firstId = first.jobs[0]?.id;
  if (!firstId) throw new Error('The allowed editor did not receive a job');
  await app().runtime.worker.execute();
  expect(await app().runtime.repository.get(firstId)).toMatchObject({ status: 'succeeded' });
  const before = await target(id);
  const requests = app().mock.requests.length;
  const second = await enqueue(id, deniedTitle.id);
  const secondId = second.jobs[0]?.id;
  if (!secondId) throw new Error('The editor did not receive an unchanged job');
  await app().runtime.worker.execute();
  expect(await app().runtime.repository.get(secondId)).toMatchObject({ status: 'succeeded' });
  expect(await target(id)).toEqual(before);
  expect(app().mock.requests).toHaveLength(requests);
});

it.each(['card', 'cards'])(
  'checks native nested %s title Read independently from component writes',
  async (field) => {
    const editor = await actor(true, true, true);
    const id = await document();
    const fields = ['title', 'slug', 'count', 'image'].map((name) => `${field}.${name}`);
    const permissions = z
      .array(
        z.object({
          id: z.number(),
          action: z.string(),
          properties: z.object({ locales: z.array(z.string()) }),
        })
      )
      .parse(
        await app()
          .strapi.db.query('admin::permission')
          .findMany({ where: { role: editor.roleId, subject: article } })
      );
    for (const permission of permissions) {
      const targetRead =
        permission.action.endsWith('.read') && permission.properties.locales.includes('fr');
      await app()
        .strapi.db.query('admin::permission')
        .update({
          where: { id: permission.id },
          data: {
            properties: {
              ...permission.properties,
              fields: targetRead ? fields.filter((name) => name !== `${field}.title`) : fields,
            },
          },
        });
    }
    const sourceCard = { title: 'Source nested title', slug: `nested-source-${sequence}` };
    const targetCard = { title: 'Restricted nested title', slug: null };
    for (const [locale, card] of [
      ['en', sourceCard],
      ['fr', targetCard],
    ] as const) {
      await app()
        .strapi.documents(article)
        .update({
          documentId: id,
          locale,
          data: fixtureDocumentData({ [field]: field === 'cards' ? [card] : card }),
        });
    }
    const settings = await app().runtime.savedSettings();
    settings.contentTypes[article] = {
      mediaMetadata: false,
      fields: {
        title: { translate: false },
        slug: { translate: false },
        summary: { translate: false },
        image: { translate: false },
        [`${field}.title`]: { translate: false },
        [`${field}.slug`]: { translate: true, uidStrategy: 'regenerate' },
      },
    };
    await app().runtime.saveSettings(settings);
    const requests = app().mock.requests.length;
    await expect(enqueue(id, editor.id)).rejects.toMatchObject({
      diagnostic: { code: 'permission-denied' },
    });
    const readCard = async () => {
      const found = z.record(z.string(), z.unknown()).parse(
        await app()
          .strapi.documents(article)
          .findOne({ documentId: id, locale: 'fr', populate: [field] })
      );
      return field === 'cards'
        ? z
            .array(z.object({ title: z.string(), slug: z.string().nullable() }))
            .parse(found[field])[0]
        : z.object({ title: z.string(), slug: z.string().nullable() }).parse(found[field]);
    };
    expect(await readCard()).toEqual(targetCard);
    const targetRead = permissions.find(
      (permission) =>
        permission.action.endsWith('.read') && permission.properties.locales.includes('fr')
    );
    if (!targetRead) throw new Error('The target read permission is missing');
    await app()
      .strapi.db.query('admin::permission')
      .update({
        where: { id: targetRead.id },
        data: { properties: { ...targetRead.properties, fields } },
      });
    const queued = await enqueue(id, editor.id);
    const jobId = queued.jobs[0]?.id;
    if (!jobId) throw new Error('The authorized nested translation was not queued');
    await app().runtime.worker.execute();
    expect(await app().runtime.repository.get(jobId)).toMatchObject({ status: 'succeeded' });
    expect(await readCard()).toEqual({
      title: 'Restricted nested title',
      slug: 'restricted-nested-title',
    });
    expect(app().mock.requests).toHaveLength(requests);
  }
);
