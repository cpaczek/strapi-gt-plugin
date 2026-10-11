import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/constants';
import type { ContentSchema, JsonObject, PluginSettings } from '../../shared/contracts';
import { mediaSourceHash, translationEngine } from '../../server/src/engine';
import {
  createMediaService,
  mediaStructureHash,
  mediaOccurrences,
  preparationTarget,
  appliedMedia,
} from '../../server/src/media-service';
import { createRepository } from '../../server/src/repository';
import { persistenceFixture } from './persistence-fixture';

const schema: ContentSchema = {
  uid: 'api::article.article',
  localized: true,
  draftAndPublish: true,
  attributes: {
    title: { type: 'string', localized: true },
    image: { type: 'media', localized: true },
  },
};
const settings: PluginSettings = {
  ...DEFAULT_SETTINGS,
  contentTypes: {
    [schema.uid]: {
      fields: { image: { translate: true, context: 'Article photograph' } },
      mediaMetadata: true,
    },
  },
};
const asset: JsonObject = {
  id: 1,
  hash: 'original-file',
  url: '/image.svg',
  alternativeText: 'Clouds',
  caption: 'Sky',
};
const document: JsonObject = {
  documentId: 'doc',
  locale: 'fr',
  publishedAt: null,
  title: 'Article',
  image: asset,
};
const setup = async () => {
  const fixture = persistenceFixture();
  await fixture.host.db.query('plugin::upload.file').create({ data: asset });
  const repository = createRepository(fixture.host);
  const service = createMediaService(fixture.host, repository);
  return { ...fixture, repository, service };
};
const translated = (value: string | null = 'Nuages') =>
  ({
    path: ['image'],
    assetId: '1',
    property: 'alternativeText',
    sourceHash: mediaSourceHash(asset, 'alternativeText', 'Article photograph'),
    structureHash: mediaStructureHash(document, ['image']),
    value,
    origin: 'translated',
  }) as const;
const saveDraft = async (
  repository: ReturnType<typeof createRepository>,
  value: string | null = 'Nuages'
) =>
  repository.saveState(schema.uid, 'doc', 'fr', 'draft', {
    checkpoints: {},
    media: [translated(value)],
    appliedJob: 7,
  });

describe('localized media state', () => {
  it('decorates only the draft snapshot for a draft response', async () => {
    const { service, repository } = await setup();
    await saveDraft(repository);
    const result = await service.decorate(document, schema, {}, settings);
    expect(result).toMatchObject({ image: { alternativeText: 'Nuages' } });
    expect(
      await service.decorate({ ...document, publishedAt: '2026-10-10' }, schema, {}, settings)
    ).toMatchObject({ image: { alternativeText: 'Clouds' } });
  });
  it('keeps shared media unchanged after a localized manual edit', async () => {
    const { service, records } = await setup();
    const result = await service.edit(
      {
        contentType: schema.uid,
        documentId: 'doc',
        locale: 'fr',
        path: ['image'],
        property: 'alternativeText',
        value: 'Manuel',
        reset: false,
      },
      schema,
      {},
      document,
      settings
    );
    expect(result.items[0]).toMatchObject({ value: 'Manuel', status: 'manual' });
    expect(records('plugin::upload.file')[0]).toMatchObject(asset);
  });
  it('preserves a deliberate null and an empty string separately', async () => {
    const { service, repository } = await setup();
    await saveDraft(repository, null);
    expect(
      (await service.items(schema, {}, document, settings, 'draft')).items[0]?.value
    ).toBeNull();
    await saveDraft(repository, '');
    expect((await service.items(schema, {}, document, settings, 'draft')).items[0]?.value).toBe('');
  });
  it('marks raw metadata changes stale and falls back to current content metadata', async () => {
    const { service, repository, host } = await setup();
    await saveDraft(repository);
    await host.db
      .query('plugin::upload.file')
      .update({ where: { id: 1 }, data: { alternativeText: 'Rain' } });
    const current = { ...document, image: { ...asset, alternativeText: 'Rain' } };
    expect((await service.items(schema, {}, current, settings, 'draft')).items[0]?.status).toBe(
      'stale'
    );
    expect(await service.decorate(current, schema, {}, settings)).toMatchObject({
      image: { alternativeText: 'Rain' },
    });
  });
  it('does not decorate a field excluded by population', async () => {
    const { service, repository } = await setup();
    await saveDraft(repository);
    expect(await service.decorate({ ...document, image: 1 }, schema, {}, settings)).toEqual({
      ...document,
      image: 1,
    });
  });
  it('does not add excluded alt text to populated media', async () => {
    const { service, repository } = await setup();
    await saveDraft(repository);
    const selected = { ...document, image: { id: 1, hash: 'original-file', url: '/image.svg' } };
    expect(await service.decorate(selected, schema, {}, settings)).toEqual(selected);
  });
  it('requires identity and publication state before decorating', async () => {
    const { service, repository } = await setup();
    await saveDraft(repository);
    const missing = { locale: 'fr', image: asset };
    expect(await service.decorate(missing, schema, {}, settings)).toEqual(missing);
    const noPublication = { documentId: 'doc', locale: 'fr', image: asset };
    expect(await service.decorate(noPublication, schema, {}, settings)).toEqual(noPublication);
  });
  it('handles null and list responses without changing shape', async () => {
    const { service, repository } = await setup();
    await saveDraft(repository);
    expect(await service.decorate(null, schema, {}, settings)).toBeNull();
    expect(await service.decorate([document], schema, {}, settings)).toEqual([
      expect.objectContaining({ image: expect.objectContaining({ alternativeText: 'Nuages' }) }),
    ]);
  });
  it('separates two articles sharing the same asset', async () => {
    const { service, repository } = await setup();
    await saveDraft(repository);
    expect(
      await service.decorate({ ...document, documentId: 'another' }, schema, {}, settings)
    ).toMatchObject({ image: { alternativeText: 'Clouds' } });
  });
  it('resets localized metadata without changing shared metadata', async () => {
    const { service, repository } = await setup();
    await saveDraft(repository);
    const result = await service.edit(
      {
        contentType: schema.uid,
        documentId: 'doc',
        locale: 'fr',
        path: ['image'],
        property: 'alternativeText',
        value: null,
        reset: true,
      },
      schema,
      {},
      document,
      settings
    );
    expect(result.items[0]).toMatchObject({ value: 'Clouds', status: 'source' });
  });
  it('publishes immediately only for types without Draft and Publish', async () => {
    const { service, repository } = await setup();
    await service.edit(
      {
        contentType: schema.uid,
        documentId: 'doc',
        locale: 'fr',
        path: ['image'],
        property: 'caption',
        value: 'Ciel',
        reset: false,
      },
      { ...schema, draftAndPublish: false },
      {},
      document,
      settings
    );
    expect((await repository.state(schema.uid, 'doc', 'fr', 'published')).media).toHaveLength(1);
  });
  it('refuses editing an unrelated path', async () => {
    const { service } = await setup();
    await expect(
      service.edit(
        {
          contentType: schema.uid,
          documentId: 'doc',
          locale: 'fr',
          path: ['unrelated'],
          property: 'caption',
          value: 'Text',
          reset: false,
        },
        schema,
        {},
        document,
        settings
      )
    ).rejects.toThrow();
  });
  it('invalidates component order while ignoring draft numeric identities', () => {
    const first = {
      ...document,
      entries: [
        { id: 1, title: 'A', image: asset },
        { id: 2, title: 'B', image: asset },
      ],
    };
    const reordered = {
      ...document,
      entries: [
        { id: 3, title: 'B', image: asset },
        { id: 4, title: 'A', image: asset },
      ],
    };
    expect(mediaStructureHash(first)).not.toBe(mediaStructureHash(reordered));
    expect(mediaStructureHash(document)).toBe(
      mediaStructureHash({ ...document, id: 999, publishedAt: 'published', updatedAt: 'later' })
    );
  });
  it('uses local overlay values for human edit protection', () => {
    const state = {
      checkpoints: {},
      media: [{ ...translated('Manual'), origin: 'manual' as const }],
      appliedJob: 1,
    };
    expect(
      preparationTarget(document, mediaOccurrences(document, schema, {}, settings), state)
    ).toMatchObject({ image: { alternativeText: 'Manual', caption: null } });
    expect(document.image).toEqual(asset);
  });
  it('creates separate overlays for each metadata property', () => {
    const result = appliedMedia(
      {
        patch: {},
        checkpoints: {},
        readDependencies: [],
        media: [
          { path: ['image'], assetId: '1', sourceHash: 'h', alternativeText: 'Nuages' },
          { path: ['image'], assetId: '1', sourceHash: 'c', caption: 'Ciel' },
        ],
      },
      document,
      { checkpoints: {}, media: [], appliedJob: null },
      document
    );
    expect(result).toHaveLength(2);
    expect(result.map((item) => item.property)).toEqual(['alternativeText', 'caption']);
  });
  it('validates raw asset snapshots before applying translations', async () => {
    const { service, host } = await setup();
    const prepared = translationEngine.prepare({
      schema,
      components: {},
      source: document,
      target: null,
      rules: settings.contentTypes[schema.uid]!.fields,
      checkpoints: {},
      force: false,
      mediaMetadata: true,
    });
    await expect(service.validatePrepared(prepared)).resolves.toBeUndefined();
    await host.db
      .query('plugin::upload.file')
      .update({ where: { id: 1 }, data: { caption: 'Changed' } });
    await expect(service.validatePrepared(prepared)).rejects.toThrow();
  });
});

it('keeps media localization when unrelated relations are populated', async () => {
  const { service, repository } = await setup();
  await saveDraft(repository);
  const result = await service.decorate(
    { ...document, category: { id: 9, title: 'News' } },
    schema,
    {},
    settings
  );
  expect(result).toMatchObject({ image: { alternativeText: 'Nuages' } });
});

it('traverses repeatable components and dynamic zones with inherited context', () => {
  const child: ContentSchema = {
    uid: 'shared.gallery',
    localized: true,
    draftAndPublish: false,
    attributes: { image: { type: 'media' } },
  };
  const parent: ContentSchema = {
    ...schema,
    attributes: {
      cards: { type: 'component', component: child.uid, repeatable: true, localized: true },
      zones: { type: 'dynamiczone', components: [child.uid], localized: true },
      ignored: { type: 'media', localized: true },
    },
  };
  const configured = {
    ...settings,
    contentTypes: {
      [schema.uid]: {
        mediaMetadata: true,
        fields: {
          cards: { translate: true, context: 'Gallery photograph' },
          ignored: { translate: false },
        },
      },
    },
  };
  const occurrences = mediaOccurrences(
    {
      cards: [{ image: asset }],
      zones: [{ __component: child.uid, image: asset }],
      ignored: asset,
    },
    parent,
    { [child.uid]: child },
    configured
  );
  expect(occurrences.map((item) => item.path)).toEqual([
    ['cards', 0, 'image'],
    ['zones', 0, 'image'],
  ]);
  expect(occurrences[0]?.context).toBe('Gallery photograph');
});
it('does not overlay malformed results or invent missing document identity', async () => {
  const { service } = await setup();
  expect(await service.decorate([null, 7, 'text'], schema, {}, settings)).toEqual([
    null,
    7,
    'text',
  ]);
  await expect(service.items(schema, {}, { image: asset }, settings, 'draft')).rejects.toThrow();
});
it('refuses draft media overlays on the public delivery path', async () => {
  const { service, repository } = await setup();
  await saveDraft(repository);
  expect(await service.decorate(document, schema, {}, settings, true)).toMatchObject({
    image: { alternativeText: 'Clouds' },
  });
});
it('suppresses overlays after the source asset is removed', async () => {
  const { service, repository, host } = await setup();
  await saveDraft(repository);
  await host.db.query('plugin::upload.file').deleteMany({ where: { id: 1 } });
  expect(await service.decorate(document, schema, {}, settings)).toMatchObject({
    image: { alternativeText: 'Clouds' },
  });
  expect((await service.items(schema, {}, document, settings, 'draft')).items).toEqual([]);
});
it('rejects a localized metadata edit after its file was removed', async () => {
  const { service, host } = await setup();
  await host.db.query('plugin::upload.file').deleteMany({ where: { id: 1 } });
  await expect(
    service.edit(
      {
        contentType: schema.uid,
        documentId: 'doc',
        locale: 'fr',
        path: ['image'],
        property: 'caption',
        value: 'New',
        reset: false,
      },
      schema,
      {},
      document,
      settings
    )
  ).rejects.toThrow();
});
it('does not emit properties with an invalid stored type', async () => {
  const { service, host } = await setup();
  await host.db
    .query('plugin::upload.file')
    .update({ where: { id: 1 }, data: { alternativeText: 9, caption: null } });
  expect((await service.items(schema, {}, document, settings, 'draft')).items).toEqual([
    expect.objectContaining({ property: 'caption', source: null }),
  ]);
});
it('does not emit absent raw metadata properties', async () => {
  const { service, records } = await setup();
  const raw = records('plugin::upload.file')[0];
  if (!raw) throw new Error('Missing file');
  delete raw.alternativeText;
  delete raw.caption;
  expect((await service.items(schema, {}, document, settings, 'draft')).items).toEqual([]);
});
it('rejects a prepared media translation after the raw file was deleted', async () => {
  const { service, host } = await setup();
  const prepared = translationEngine.prepare({
    schema,
    components: {},
    source: document,
    target: null,
    rules: {},
    checkpoints: {},
    force: false,
    mediaMetadata: true,
  });
  await host.db.query('plugin::upload.file').deleteMany({ where: { id: 1 } });
  await expect(service.validatePrepared(prepared)).rejects.toThrow();
});
it('keeps valid unchanged overlays when text changes in another field', () => {
  const state = { checkpoints: {}, media: [translated()], appliedJob: 1 };
  const changed = { ...document, title: 'New title' };
  expect(
    appliedMedia(
      { patch: { title: 'New title' }, checkpoints: {}, media: [], readDependencies: [] },
      changed,
      state,
      document
    )
  ).toEqual([translated()]);
});
it('retains stale overlays for review without rebinding them to a replacement asset', () => {
  const state = { checkpoints: {}, media: [translated()], appliedJob: 1 };
  const changed = { ...document, image: { ...asset, id: 4 } };
  const result = appliedMedia(
    {
      patch: {},
      checkpoints: {},
      media: [{ path: ['image'], assetId: '9', sourceHash: 'h', caption: 'Wrong' }],
      readDependencies: [],
    },
    changed,
    state,
    null
  );
  expect(result).toEqual(state.media);
});
it('replaces a translated property while preserving another localized property', () => {
  const state = { checkpoints: {}, media: [translated()], appliedJob: 1 };
  const result = appliedMedia(
    {
      patch: {},
      checkpoints: {},
      media: [{ path: ['image'], assetId: '1', sourceHash: 'new', alternativeText: 'Nouveau' }],
      readDependencies: [],
    },
    document,
    state,
    document
  );
  expect(result).toHaveLength(1);
  expect(result[0]?.value).toBe('Nouveau');
});
