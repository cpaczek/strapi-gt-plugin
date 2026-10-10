import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startStrapiFixture } from './strapi-fixture';

let fixture: Awaited<ReturnType<typeof startStrapiFixture>> | undefined;
beforeAll(async () => {
  fixture = await startStrapiFixture();
}, 60_000);
afterAll(async () => {
  if (fixture) await fixture.close();
}, 60_000);
const app = () => {
  if (!fixture) throw new Error('Strapi fixture did not boot');
  return fixture;
};
describe('real Strapi plugin runtime', () => {
  it('uses the registered plugin runtime', () => {
    expect(app().strapi.plugin('general-translation').service('translation')).toBe(app().runtime);
  });
  it('translates a missing locale as an attributed draft', async () => {
    const { runtime, source, actorId, strapi } = app();
    const response = await runtime.enqueue(
      {
        contentType: 'api::article.article',
        documentIds: [source.documentId],
        targetLocales: ['fr'],
        force: false,
      },
      actorId,
      'translate'
    );
    const id = response.jobs[0]?.id;
    if (!id) throw new Error('No translation job was created');
    await runtime.worker.execute();
    await runtime.worker.execute();
    const job = await runtime.repository.get(id);
    expect(job).toMatchObject({ status: 'succeeded' });
    const target: unknown = await strapi.documents('api::article.article').findOne({
      documentId: source.documentId,
      locale: 'fr',
      status: 'draft',
      populate: { createdBy: true, updatedBy: true, image: true },
    });
    expect(target).toMatchObject({
      title: '[fr] Hello',
      createdBy: { id: actorId },
      updatedBy: { id: actorId },
    });
    expect(
      await strapi
        .documents('api::article.article')
        .findOne({ documentId: source.documentId, locale: 'fr', status: 'published' })
    ).toBeNull();
  });
});

import { beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import plugin from '../../server/src';

beforeEach(async () => {
  if (fixture) await fixture.runtime.saveSettings(fixture.settings);
});
afterEach(async () => {
  if (fixture)
    await fixture.strapi.db
      .query('plugin::general-translation.job')
      .deleteMany({ where: { status: { $in: ['queued', 'running', 'waiting'] } } });
});
const freshSource = async () => {
  const { strapi, actorId, assetId } = app();
  return z.object({ documentId: z.string() }).parse(
    await strapi.documents('api::article.article').create({
      locale: 'en',
      data: {
        title: 'A new article',
        summary: 'Some context',
        image: assetId,
        createdBy: actorId,
        updatedBy: actorId,
      },
    })
  );
};
const queue = async (documentId: string, force = false, actorId = app().actorId) => {
  const result = await app().runtime.enqueue(
    {
      contentType: 'api::article.article',
      documentIds: [documentId],
      targetLocales: ['fr'],
      force,
    },
    actorId,
    'translate'
  );
  const id = result.jobs[0]?.id;
  if (!id) throw new Error('No job was enqueued');
  return id;
};
const finish = async (id: number) => {
  const { runtime } = app();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const job = await runtime.repository.get(id);
    if (job && ['failed', 'conflict', 'succeeded'].includes(job.status)) return job;
    await runtime.worker.execute();
  }
  throw new Error('The worker did not reach a terminal stage');
};
const target = (documentId: string) =>
  app()
    .strapi.documents('api::article.article')
    .findOne({ documentId, locale: 'fr', status: 'draft', populate: { image: true } });
const context = (body?: unknown) => {
  const req = new IncomingMessage(new Socket());
  const response = new ServerResponse(req);
  const ctx = app().strapi.server.app.createContext(req, response);
  ctx.state.user = { id: app().actorId };
  if (body !== undefined) Object.defineProperty(ctx.request, 'body', { value: body });
  return ctx;
};

describe('real runtime conflict and permission controls', () => {
  it('enforces lease uniqueness in SQLite itself', async () => {
    await expect(
      app()
        .strapi.db.query('plugin::general-translation.lease')
        .create({ data: { key: 'slot:0' } })
    ).rejects.toThrow();
  });
  it('returns key presence without the credential', async () => {
    const response = await app().runtime.settings();
    expect(response.hasApiKey).toBe(true);
    expect(response.maskedApiKey).toBe('********');
    expect(JSON.stringify(response)).not.toContain(process.env.GT_API_KEY);
    expect((await app().runtime.translationOptions()).configured).toBe(true);
  });
  it('checks the actual GT project connection', async () => {
    expect(await app().runtime.connection()).toMatchObject({
      project: { id: 'editorial', sourceLocale: 'en' },
      message: { code: 'connection-success' },
    });
  });
  it('rejects browser key storage before changing settings', async () => {
    await expect(
      app().runtime.saveSettings({ ...app().settings, apiKey: 'must-not-store' })
    ).rejects.toThrow();
    expect(JSON.stringify(await app().runtime.settings())).not.toContain('must-not-store');
  });
  it('rejects unconfigured locales and single-action bulk requests', async () => {
    const source = await freshSource();
    await expect(
      app().runtime.enqueue(
        {
          contentType: 'api::article.article',
          documentIds: [source.documentId],
          targetLocales: ['de'],
          force: false,
        },
        app().actorId,
        'translate'
      )
    ).rejects.toThrow();
    await expect(
      app().runtime.enqueue(
        {
          contentType: 'api::article.article',
          documentIds: [source.documentId, source.documentId],
          targetLocales: ['fr'],
          force: false,
        },
        app().actorId,
        'translate'
      )
    ).rejects.toThrow();
  });
  it('reuses an existing active job for the same actor and locale', async () => {
    const source = await freshSource();
    expect(await queue(source.documentId)).toBe(await queue(source.documentId));
  });
  it('refuses missing locale creation when it is disabled', async () => {
    const source = await freshSource();
    await app().runtime.saveSettings({ ...app().settings, createMissingLocales: false });
    await expect(queue(source.documentId)).rejects.toThrow();
    expect(await target(source.documentId)).toBeNull();
  });
  it('preserves preexisting human text while translating other fields', async () => {
    const source = await freshSource();
    await app()
      .strapi.documents('api::article.article')
      .update({
        documentId: source.documentId,
        locale: 'fr',
        data: { title: 'Human title', createdBy: app().actorId, updatedBy: app().actorId },
      });
    expect((await finish(await queue(source.documentId))).status).toBe('succeeded');
    expect(await target(source.documentId)).toMatchObject({
      title: 'Human title',
      summary: '[fr] Some context',
    });
  });
  it('allows explicit forced retranslation of existing human text', async () => {
    const source = await freshSource();
    await app()
      .strapi.documents('api::article.article')
      .update({ documentId: source.documentId, locale: 'fr', data: { title: 'Human title' } });
    expect((await finish(await queue(source.documentId, true))).status).toBe('succeeded');
    expect(await target(source.documentId)).toMatchObject({ title: '[fr] A new article' });
  });
  it('rejects source edits after the remote result arrives', async () => {
    const source = await freshSource();
    const id = await queue(source.documentId);
    await app().runtime.worker.execute();
    await app()
      .strapi.documents('api::article.article')
      .update({ documentId: source.documentId, locale: 'en', data: { title: 'Changed source' } });
    expect(await finish(id)).toMatchObject({ status: 'conflict', error: { code: 'stale-source' } });
    expect(await target(source.documentId)).toBeNull();
  });
  it('rejects an intervening target edit even when force was requested', async () => {
    const source = await freshSource();
    await app()
      .strapi.documents('api::article.article')
      .update({ documentId: source.documentId, locale: 'fr', data: { title: 'Earlier edit' } });
    const id = await queue(source.documentId, true);
    await app().runtime.worker.execute();
    await app()
      .strapi.documents('api::article.article')
      .update({ documentId: source.documentId, locale: 'fr', data: { title: 'Newer human edit' } });
    expect(await finish(id)).toMatchObject({ status: 'conflict', error: { code: 'human-edit' } });
    expect(await target(source.documentId)).toMatchObject({ title: 'Newer human edit' });
  });
  it('rechecks actor activation before applying queued work', async () => {
    const source = await freshSource();
    const id = await queue(source.documentId);
    await app().runtime.worker.execute();
    await app()
      .strapi.db.query('admin::user')
      .update({ where: { id: app().actorId }, data: { isActive: false } });
    try {
      expect(await finish(id)).toMatchObject({
        status: 'failed',
        error: { code: 'permission-denied' },
      });
      expect(await target(source.documentId)).toBeNull();
    } finally {
      await app()
        .strapi.db.query('admin::user')
        .update({ where: { id: app().actorId }, data: { isActive: true } });
    }
  });
  it('stops when settings change before application', async () => {
    const source = await freshSource();
    const id = await queue(source.documentId);
    await app().runtime.worker.execute();
    await app().runtime.saveSettings({ ...app().settings, autoPublish: true });
    expect(await finish(id)).toMatchObject({ status: 'failed', error: { code: 'validation' } });
    expect(await target(source.documentId)).toBeNull();
  });
  it('retries a corrected provider failure through the saved stage', async () => {
    const source = await freshSource();
    const id = await queue(source.documentId);
    app().mock.failNext({ status: 401 });
    expect(await finish(id)).toMatchObject({ status: 'failed', error: { code: 'invalid-key' } });
    expect((await app().runtime.retry(id, app().actorId)).jobs[0]?.id).toBe(id);
    expect((await finish(id)).status).toBe('succeeded');
  });
  it('does not let a different actor retry a saved job', async () => {
    const source = await freshSource();
    const id = await queue(source.documentId);
    await expect(app().runtime.retry(id, app().actorId + 1)).rejects.toThrow();
  });
  it('publishes only after a separate permitted opt-in action', async () => {
    const source = await freshSource();
    await app().runtime.saveSettings({ ...app().settings, autoPublish: true });
    const id = await queue(source.documentId);
    expect((await finish(id)).status).toBe('succeeded');
    expect(
      await app()
        .strapi.documents('api::article.article')
        .findOne({ documentId: source.documentId, locale: 'fr', status: 'published' })
    ).toMatchObject({ title: '[fr] A new article' });
    expect(
      (
        await app().runtime.repository.state(
          'api::article.article',
          source.documentId,
          'fr',
          'published'
        )
      ).appliedJob
    ).toBe(id);
  });
  it('filters history by actor, document, and latest locale', async () => {
    const source = await freshSource();
    const id = await queue(source.documentId);
    await finish(id);
    const history = await app().runtime.history(app().actorId, {
      page: 1,
      contentType: 'api::article.article',
      documentId: source.documentId,
      latestPerLocale: true,
    });
    expect(history.jobs).toHaveLength(1);
    expect(history.jobs[0]?.id).toBe(id);
    await expect(
      app().runtime.history(app().actorId, { page: 1, latestPerLocale: true })
    ).rejects.toThrow();
  });
  it('keeps localized media editing separate from shared upload metadata', async () => {
    const source = await freshSource();
    await finish(await queue(source.documentId));
    const edited = await app().runtime.mediaDocument(
      'api::article.article',
      source.documentId,
      'fr',
      'draft',
      app().actorId,
      {
        contentType: 'api::article.article',
        documentId: source.documentId,
        locale: 'fr',
        path: ['image'],
        property: 'alternativeText',
        value: '',
        reset: false,
      }
    );
    expect(edited.items.find((item) => item.property === 'alternativeText')).toMatchObject({
      value: '',
      status: 'manual',
    });
    expect(
      await app()
        .strapi.db.query('plugin::upload.file')
        .findOne({ where: { id: app().assetId } })
    ).toMatchObject({ alternativeText: 'Clouds' });
    const cleared = await app().runtime.mediaDocument(
      'api::article.article',
      source.documentId,
      'fr',
      'draft',
      app().actorId,
      {
        contentType: 'api::article.article',
        documentId: source.documentId,
        locale: 'fr',
        path: ['image'],
        property: 'alternativeText',
        value: null,
        reset: true,
      }
    );
    expect(cleared.items.find((item) => item.property === 'alternativeText')?.status).toBe(
      'source'
    );
  });
  it('rejects disabled media metadata and nonexistent target locales', async () => {
    const source = await freshSource();
    await expect(
      app().runtime.mediaDocument(
        'api::article.article',
        source.documentId,
        'fr',
        'draft',
        app().actorId
      )
    ).rejects.toThrow();
    const configured = {
      ...app().settings,
      contentTypes: {
        'api::article.article': { fields: { title: { translate: true } }, mediaMetadata: false },
      },
    };
    await app().runtime.saveSettings(configured);
    await expect(
      app().runtime.mediaDocument(
        'api::article.article',
        source.documentId,
        'en',
        'draft',
        app().actorId
      )
    ).rejects.toThrow();
  });
});

describe('real Koa controller boundaries', () => {
  it('returns a typed validation error with no submitted key', async () => {
    const ctx = context({ ...app().settings, apiKey: 'never-return-this' });
    await plugin.controllers.translation({ strapi: app().strapi }).saveSettings(ctx);
    expect(ctx.status).toBe(400);
    expect(ctx.body).toMatchObject({ error: { code: 'validation' } });
    expect(JSON.stringify(ctx.body)).not.toContain('never-return-this');
  });
  it('serves settings, translator options and connection responses', async () => {
    const controllers = plugin.controllers.translation({ strapi: app().strapi });
    const settingsContext = context();
    await controllers.settings(settingsContext);
    expect(settingsContext.body).toMatchObject({ hasApiKey: true });
    const optionsContext = context();
    await controllers.translationOptions(optionsContext);
    expect(optionsContext.body).toMatchObject({ configured: true });
    const connectionContext = context();
    await controllers.connection(connectionContext);
    expect(connectionContext.body).toMatchObject({ message: { code: 'connection-success' } });
  });
  it('rejects a translation request without an actor', async () => {
    const ctx = context({
      contentType: 'api::article.article',
      documentIds: [app().source.documentId],
      targetLocales: ['fr'],
      force: false,
    });
    ctx.state = {};
    await plugin.controllers.translation({ strapi: app().strapi }).translate(ctx);
    expect(ctx.status).toBe(403);
    expect(ctx.body).toMatchObject({ error: { code: 'permission-denied' } });
  });
});

it('rejects a changed schema snapshot before applying saved translations', async () => {
  const source = await freshSource();
  const id = await queue(source.documentId);
  await app().runtime.worker.execute();
  const attribute = app().strapi.contentType('api::article.article').attributes.title;
  if (!attribute) throw new Error('Missing title schema');
  const original = attribute.private;
  attribute.private = true;
  try {
    expect(await finish(id)).toMatchObject({ status: 'failed', error: { code: 'validation' } });
    expect(await target(source.documentId)).toBeNull();
  } finally {
    if (original === undefined) delete attribute.private;
    else attribute.private = original;
  }
});

import { PERMISSIONS } from '../../shared/constants';
let roleSequence = 0;
const limitedActor = async (
  options: {
    plugin?: boolean;
    read?: string[];
    create?: string[];
    update?: string[];
    readLocales?: string[];
    createLocales?: string[];
    publish?: boolean;
  } = {}
) => {
  roleSequence += 1;
  const strapi = app().strapi;
  const role = z.object({ id: z.number() }).parse(
    await strapi.db.query('admin::role').create({
      data: {
        name: `Server role ${roleSequence}`,
        code: `server-role-${roleSequence}`,
        description: 'Fixture role',
      },
    })
  );
  if (options.plugin !== false)
    await strapi.db.query('admin::permission').create({
      data: {
        role: role.id,
        action: PERMISSIONS.translate,
        subject: null,
        properties: {},
        conditions: [],
      },
    });
  for (const action of ['read', 'create', 'update'] as const) {
    const fields = options[action] ?? ['title'];
    const locales =
      action === 'read' ? (options.readLocales ?? ['en', 'fr']) : (options.createLocales ?? ['fr']);
    await strapi.db.query('admin::permission').create({
      data: {
        role: role.id,
        action: `plugin::content-manager.explorer.${action}`,
        subject: 'api::article.article',
        properties: { fields, locales },
        conditions: [],
      },
    });
  }
  if (options.publish)
    await strapi.db.query('admin::permission').create({
      data: {
        role: role.id,
        action: 'plugin::content-manager.explorer.publish',
        subject: 'api::article.article',
        properties: { locales: ['fr'] },
        conditions: [],
      },
    });
  const actor = z.object({ id: z.number() }).parse(
    await strapi.db.query('admin::user').create({
      data: {
        firstname: 'Limited',
        lastname: 'Editor',
        email: `limited-${roleSequence}@example.invalid`,
        isActive: true,
        roles: [role.id],
      },
    })
  );
  return actor.id;
};
const titleOnly = () => ({
  ...app().settings,
  contentTypes: {
    'api::article.article': {
      mediaMetadata: false,
      fields: {
        title: { translate: true },
        summary: { translate: false },
        image: { translate: false },
        card: { translate: false },
        cards: { translate: false },
        sections: { translate: false },
      },
    },
  },
});

describe('actual Strapi RBAC decisions', () => {
  it('allows a translator with only the selected field and locale rights', async () => {
    await app().runtime.saveSettings(titleOnly());
    const source = await freshSource();
    const actorId = await limitedActor({ readLocales: ['en'], createLocales: ['fr'] });
    const id = await queue(source.documentId, false, actorId);
    expect((await finish(id)).status).toBe('succeeded');
    expect(
      await app()
        .strapi.documents('api::article.article')
        .findOne({
          documentId: source.documentId,
          locale: 'fr',
          status: 'draft',
          populate: { createdBy: { fields: ['id'] } },
        })
    ).toMatchObject({ title: '[fr] A new article', createdBy: { id: actorId } });
  });
  it('refuses content rights without the plugin translation action', async () => {
    await app().runtime.saveSettings(titleOnly());
    const source = await freshSource();
    const actorId = await limitedActor({ plugin: false });
    await expect(queue(source.documentId, false, actorId)).rejects.toThrow();
    await expect(app().runtime.history(actorId, { page: 1 })).rejects.toThrow();
  });
  it('refuses source field reads outside the actor allowed fields', async () => {
    await app().runtime.saveSettings(titleOnly());
    const source = await freshSource();
    const actorId = await limitedActor({ read: ['summary'] });
    await expect(queue(source.documentId, false, actorId)).rejects.toThrow();
  });
  it('refuses the source locale outside the actor locale grant', async () => {
    await app().runtime.saveSettings(titleOnly());
    const source = await freshSource();
    const actorId = await limitedActor({ readLocales: ['fr'] });
    await expect(queue(source.documentId, false, actorId)).rejects.toThrow();
  });
  it('refuses target creation outside the actor locale grant', async () => {
    await app().runtime.saveSettings(titleOnly());
    const source = await freshSource();
    const actorId = await limitedActor({ createLocales: ['ar'] });
    await expect(queue(source.documentId, false, actorId)).rejects.toThrow();
  });
  it('refuses automatic publication without publish permission', async () => {
    await app().runtime.saveSettings({ ...titleOnly(), autoPublish: true });
    const source = await freshSource();
    const actorId = await limitedActor();
    await expect(queue(source.documentId, false, actorId)).rejects.toThrow();
  });
  it('refuses media editing when the actor cannot read that field', async () => {
    const source = await freshSource();
    await finish(await queue(source.documentId));
    const actorId = await limitedActor();
    await expect(
      app().runtime.mediaDocument('api::article.article', source.documentId, 'fr', 'draft', actorId)
    ).rejects.toThrow();
  });
});

it('translates nested components and dynamic zones using real permission subjects', async () => {
  const { strapi, actorId, assetId } = app();
  const source = z.object({ documentId: z.string() }).parse(
    await strapi.documents('api::article.article').create({
      locale: 'en',
      data: {
        title: 'Nested',
        card: { title: 'Single card', count: 5, image: assetId },
        cards: [
          { title: 'First card', count: 2 },
          { title: 'Second card', count: 3 },
        ],
        sections: [{ __component: 'editorial.card', title: 'Zone card', count: 1, image: assetId }],
        createdBy: actorId,
        updatedBy: actorId,
      },
    })
  );
  const id = await queue(source.documentId);
  expect(await finish(id)).toMatchObject({ status: 'succeeded' });
  const translated: unknown = await strapi.documents('api::article.article').findOne({
    documentId: source.documentId,
    locale: 'fr',
    status: 'draft',
    populate: { card: true, cards: true, sections: true },
  });
  expect(translated).toMatchObject({
    card: { title: '[fr] Single card', count: 5 },
    cards: [{ title: '[fr] First card' }, { title: '[fr] Second card' }],
    sections: [{ __component: 'editorial.card', title: '[fr] Zone card' }],
  });
});
it('applies an already committed job idempotently after completion recovery', async () => {
  const source = await freshSource();
  const id = await queue(source.documentId);
  await finish(id);
  await app()
    .strapi.documents('api::article.article')
    .update({ documentId: source.documentId, locale: 'fr', data: { title: 'Later human edit' } });
  await app()
    .strapi.db.query('plugin::general-translation.job')
    .update({
      where: { id },
      data: { status: 'queued', nextRunAt: new Date(0), leaseOwner: null, leaseUntil: null },
    });
  expect((await finish(id)).status).toBe('succeeded');
  expect(await target(source.documentId)).toMatchObject({ title: 'Later human edit' });
});
it('keeps no-op source checks local without calling GT again', async () => {
  const source = await freshSource();
  await finish(await queue(source.documentId));
  const requests = app().mock.requests.length;
  expect((await finish(await queue(source.documentId))).status).toBe('succeeded');
  expect(app().mock.requests.length).toBe(requests);
});
it('writes translations immediately for content types without drafts', async () => {
  const { strapi, actorId } = app();
  const source = z.object({ documentId: z.string() }).parse(
    await strapi.documents('api::note.note').create({
      locale: 'en',
      data: { title: 'Live note', createdBy: actorId, updatedBy: actorId },
    })
  );
  await app().runtime.saveSettings({
    ...app().settings,
    contentTypes: {
      ...app().settings.contentTypes,
      'api::note.note': { fields: { title: { translate: true } }, mediaMetadata: false },
    },
  });
  const result = await app().runtime.enqueue(
    {
      contentType: 'api::note.note',
      documentIds: [source.documentId],
      targetLocales: ['fr'],
      force: false,
    },
    actorId,
    'translate'
  );
  const id = result.jobs[0]?.id;
  if (!id) throw new Error('No note job');
  expect((await finish(id)).status).toBe('succeeded');
  expect(
    await strapi
      .documents('api::note.note')
      .findOne({ documentId: source.documentId, locale: 'fr', status: 'published' })
  ).toMatchObject({ title: '[fr] Live note' });
});
it('returns typed controller responses for translate, history, media, and retry', async () => {
  const controllers = plugin.controllers.translation({ strapi: app().strapi });
  const source = await freshSource();
  const translated = context({
    contentType: 'api::article.article',
    documentIds: [source.documentId],
    targetLocales: ['fr'],
    force: false,
  });
  await controllers.translate(translated);
  const queued = z.object({ jobs: z.array(z.object({ id: z.number() })) }).parse(translated.body);
  const id = queued.jobs[0]?.id;
  if (!id) throw new Error('No controller job');
  await finish(id);
  const history = context();
  history.query = {
    contentType: 'api::article.article',
    documentId: source.documentId,
    latestPerLocale: 'true',
  };
  await controllers.history(history);
  expect(history.body).toMatchObject({ total: 1 });
  const mediaContext = context();
  mediaContext.query = {
    contentType: 'api::article.article',
    documentId: source.documentId,
    locale: 'fr',
    status: 'draft',
  };
  await controllers.media(mediaContext);
  expect(mediaContext.body).toMatchObject({ draftAndPublish: true });
  const edited = context({
    contentType: 'api::article.article',
    documentId: source.documentId,
    locale: 'fr',
    path: ['image'],
    property: 'caption',
    value: 'Manual caption',
    reset: false,
  });
  await controllers.editMedia(edited);
  expect(edited.body).toMatchObject({
    items: expect.arrayContaining([expect.objectContaining({ value: 'Manual caption' })]),
  });
  const retry = context();
  retry.params = { id: 'not-an-id' };
  await controllers.retry(retry);
  expect(retry.status).toBe(400);
});
