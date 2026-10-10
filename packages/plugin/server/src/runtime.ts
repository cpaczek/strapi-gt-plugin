import type { Core } from '@strapi/strapi';
import { listSupportedLocales } from '@generaltranslation/supported-locales';
import { z } from 'zod';
import {
  DEFAULT_SETTINGS,
  GT_BASE_URL,
  PLUGIN_ID,
  SETTINGS_STORE_KEY,
} from '../../shared/constants';
import type {
  ContentSchema,
  JsonObject,
  JsonValue,
  PluginSettings,
  PreparedTranslation,
  TranslationRequest,
  SettingsResponse,
  TranslationOptionsResponse,
  MediaOverlayRequest,
} from '../../shared/contracts';
import { messages } from '../../shared/messages';
import { createGtClient, hashValue, retryDelay, translationEngine } from './engine';
import { authorizeDocument, checkContent, denied, loadActorPermissions } from './authorization';
import { createDocuments } from './documents';
import { shouldUseFiles } from './jobs';
import {
  createMediaService,
  mediaOccurrences,
  preparationTarget,
  appliedMedia,
} from './media-service';
import { createRepository, documentKey, summarizeJob } from './repository';
import { publicSettings, validateSettings } from './settings';
import { schemas, permissionField } from './strapi-schema';
import {
  DiagnosticError,
  fail,
  objectRecord,
  parseBody,
  settingsSchema,
  type StoredJob,
} from './validation';
import { createWorker } from './worker';

const enabledService = (value: unknown): value is { isEnabled(): Promise<boolean> } =>
  objectRecord(value) && typeof value.isEnabled === 'function';
const mutationFields = (
  patch: JsonObject,
  schema: ContentSchema,
  components: Record<string, ContentSchema>,
  prefix = ''
): string[] =>
  Object.entries(patch).flatMap(([name, value]) => {
    const field = schema.attributes[name];
    if (!field) return [];
    const path = prefix ? `${prefix}.${name}` : name;
    if (field.type !== 'component') return [path];
    const entries = Array.isArray(value) ? value : [value];
    return entries.flatMap((entry) => {
      if (!objectRecord(entry)) return [path];
      const component = field.type === 'dynamiczone' ? entry.__component : field.component;
      const child = typeof component === 'string' ? components[component] : undefined;
      return child ? mutationFields(entry, child, components, path) : [path];
    });
  });
export const createPluginRuntime = (strapi: Core.Strapi) => {
  const repository = createRepository(strapi);
  const documents = createDocuments(strapi);
  const media = createMediaService(strapi, repository);
  const store = () => strapi.store({ type: 'plugin', name: PLUGIN_ID, key: SETTINGS_STORE_KEY });
  const savedSettings = async (): Promise<PluginSettings> => {
    const stored: unknown = await store().get();
    return stored
      ? parseBody(settingsSchema, stored)
      : { ...structuredClone(DEFAULT_SETTINGS), projectId: process.env.GT_PROJECT_ID ?? '' };
  };
  const metadata = async () => {
    const ai: unknown = strapi.plugin('i18n').service('ai-localizations');
    if (!enabledService(ai))
      return fail(
        'Strapi AI translation settings are unavailable; check the supported Strapi version'
      );
    return {
      ...schemas(strapi),
      locales: await strapi.localization.getLocales(),
      supportedLocales: listSupportedLocales().filter((locale) => locale !== 'qbr'),
      aiTranslationsEnabled: await ai.isEnabled(),
    };
  };
  const configuration = async (settings: PluginSettings) => {
    const key = process.env.GT_API_KEY;
    if (!key?.trim()) throw new DiagnosticError(messages.missingKey());
    if (!settings.projectId) return fail('Enter a GT project ID in settings');
    const configured: unknown = strapi.config.get(`plugin::${PLUGIN_ID}.baseUrl`, GT_BASE_URL);
    const baseUrl = z.url().parse(configured);
    return createGtClient({ apiKey: key, projectId: settings.projectId, baseUrl });
  };
  const schemaFor = (contentType: string, settings: PluginSettings) => {
    const collection = schemas(strapi);
    const schema = collection.contentTypes.find((item) => item.uid === contentType);
    if (!schema?.localized || !settings.contentTypes[contentType])
      return fail('Configure a localized content type before translating it');
    return { schema, components: collection.components };
  };
  const prepare = async (job: StoredJob): Promise<PreparedTranslation> => {
    const { schema, components } = schemaFor(job.contentType, job.settings);
    const source = await documents.read(
      schema,
      components,
      job.documentId,
      job.sourceLocale,
      job.sourceStatus
    );
    if (!source) return fail('The source document no longer exists');
    const target = await documents.read(
      schema,
      components,
      job.documentId,
      job.targetLocale,
      'draft'
    );
    const state = await repository.state(
      job.contentType,
      job.documentId,
      job.targetLocale,
      'draft'
    );
    const configured = job.settings.contentTypes[job.contentType];
    if (!configured) return fail('The content type translation settings are unavailable');
    const targetSnapshot = configured.mediaMetadata
      ? preparationTarget(target, mediaOccurrences(source, schema, components, job.settings), state)
      : target;
    const prepared = translationEngine.prepare({
      schema,
      components,
      source,
      target: targetSnapshot,
      checkpoints: state.checkpoints,
      rules: configured.fields,
      force: job.force,
      mediaMetadata: configured.mediaMetadata,
    });
    await authorize(job, prepared, source, target);
    await media.validatePrepared(prepared);
    return prepared;
  };
  const authorize = async (
    job: StoredJob,
    prepared: PreparedTranslation,
    source: JsonObject,
    target: JsonObject | null,
    patch?: JsonObject
  ): Promise<void> => {
    const actor = await loadActorPermissions(strapi, job.actorId);
    const preview =
      patch ??
      translationEngine.apply(
        prepared,
        Object.fromEntries(prepared.segments.map((segment) => [segment.id, segment.text]))
      ).patch;
    const fields = new Set([
      ...prepared.segments.map((segment) =>
        permissionField(prepared.input.schema, prepared.input.components, source, segment.path)
      ),
      ...mutationFields(preview, prepared.input.schema, prepared.input.components),
    ]);
    authorizeDocument({
      pluginAllowed: actor.plugin(job.permission),
      source,
      target,
      targetLocale: job.targetLocale,
      fields: [...fields],
      createMissingLocales: job.settings.createMissingLocales,
      publish: job.settings.autoPublish && prepared.input.schema.draftAndPublish,
      can: checkContent(actor.checker(job.contentType)),
      creationActorId: job.actorId ?? denied(),
    });
  };
  const apply = async (job: StoredJob): Promise<void> => {
    if (!job.prepared) return fail('The saved source snapshot is missing');
    const prepared = job.prepared;
    await documents.transaction(prepared.input.schema, job.documentId, async () => {
      if (!(await repository.owns(job)))
        return fail('The worker lease expired before applying the translation');
      const previous = await repository.state(
        job.contentType,
        job.documentId,
        job.targetLocale,
        'draft'
      );
      if (previous.appliedJob === job.id) return;
      const currentSettings = await savedSettings();
      if (
        hashValue(settingsSchema.parse(currentSettings)) !==
        hashValue(settingsSchema.parse(job.settings))
      )
        return fail('Translation settings changed; start a new translation');
      const fresh = await prepare(job);
      if (fresh.sourceHash !== prepared.sourceHash)
        throw new DiagnosticError(messages.staleSource());
      if (fresh.targetHash !== prepared.targetHash) throw new DiagnosticError(messages.humanEdit());
      const applied = translationEngine.apply(prepared, job.translations);
      if (
        !Object.keys(applied.patch).length &&
        !applied.media.length &&
        prepared.protectedPaths.length
      )
        throw new DiagnosticError(messages.humanEdit());
      const target = await documents.read(
        prepared.input.schema,
        prepared.input.components,
        job.documentId,
        job.targetLocale,
        'draft'
      );
      if (!target && prepared.input.mediaMetadata) {
        for (const [name, field] of Object.entries(prepared.input.schema.attributes)) {
          const value = prepared.input.source[name];
          if (
            field.type !== 'media' ||
            field.private ||
            field.localized === false ||
            value === undefined ||
            prepared.input.rules[name]?.translate === false
          )
            continue;
          const relation = (asset: JsonValue): JsonValue =>
            objectRecord(asset) ? (asset.id ?? null) : asset;
          applied.patch[name] = Array.isArray(value) ? value.map(relation) : relation(value);
        }
      }
      await authorize(job, prepared, prepared.input.source, target, applied.patch);
      if (Object.keys(applied.patch).length)
        await documents.write(
          prepared.input.schema,
          job.documentId,
          job.targetLocale,
          applied.patch,
          job.actorId ?? denied(),
          !target
        );
      const updated = await documents.read(
        prepared.input.schema,
        prepared.input.components,
        job.documentId,
        job.targetLocale,
        'draft'
      );
      if (!updated && applied.media.length)
        return fail('Create the target content before translating media metadata');
      const state = {
        checkpoints: applied.checkpoints,
        media: updated ? appliedMedia(applied, updated, previous, target) : previous.media,
        appliedJob: job.id,
      };
      await repository.saveState(job.contentType, job.documentId, job.targetLocale, 'draft', state);
      if (job.settings.autoPublish && prepared.input.schema.draftAndPublish && updated)
        await documents.publish(prepared.input.schema, job.documentId, job.targetLocale);
      if (!prepared.input.schema.draftAndPublish || (job.settings.autoPublish && updated))
        await repository.saveState(
          job.contentType,
          job.documentId,
          job.targetLocale,
          'published',
          state
        );
    });
  };
  const worker = createWorker({
    repository,
    operations: async (job) => ({ client: await configuration(job.settings), prepare, apply }),
    retryDelay,
    log: (diagnostic) => strapi.log.warn(diagnostic.text),
  });
  const enqueue = async (
    request: TranslationRequest,
    actorId: number,
    permission: 'translate' | 'bulkTranslate',
    sourceStatus: 'draft' | 'published' = 'draft'
  ) => {
    const settings = validateSettings(await savedSettings(), await metadata());
    if (permission === 'translate' && request.documentIds.length !== 1)
      return fail('Use bulk translation when selecting multiple documents');
    if (
      new Set(request.documentIds).size !== request.documentIds.length ||
      new Set(request.targetLocales).size !== request.targetLocales.length
    )
      return fail('Documents and target locales must be distinct');
    if (request.targetLocales.some((locale) => !settings.targetLocales.includes(locale)))
      return fail('Choose configured target locales');
    const actor = await loadActorPermissions(strapi, actorId);
    if (!actor.plugin(permission)) return denied();
    await configuration(settings);
    const jobs: StoredJob[] = [];
    for (const documentId of request.documentIds)
      for (const targetLocale of request.targetLocales) {
        const now = new Date().toISOString();
        const job: StoredJob = {
          id: 0,
          key: documentKey(request.contentType, documentId, targetLocale),
          contentType: request.contentType,
          documentId,
          sourceLocale: settings.sourceLocale,
          targetLocale,
          actorId,
          force: request.force,
          status: 'queued',
          stage: 'prepare',
          attempts: 0,
          nextRunAt: now,
          leaseOwner: null,
          leaseUntil: null,
          prepared: null,
          file: null,
          remoteJobIds: [],
          translations: {},
          error: null,
          createdAt: now,
          updatedAt: now,
          settings,
          sourceStatus,
          permission,
        };
        job.prepared = await prepare(job);
        job.stage = job.prepared.segments.length
          ? shouldUseFiles(job.prepared)
            ? 'upload'
            : 'translate'
          : 'apply';
        jobs.push(job);
      }
    const created = await strapi.db.transaction(async () => {
      const result: StoredJob[] = [];
      for (const job of jobs) {
        const active = await repository.active(job.key);
        if (active) {
          if (active.actorId !== actorId)
            return fail('This document and locale already have a translation in progress');
          result.push(active);
        } else result.push(await repository.create(job));
      }
      return result;
    });
    return { jobs: created.map(summarizeJob) };
  };
  const settingsResponse = async (): Promise<SettingsResponse> =>
    publicSettings(await savedSettings(), await metadata(), process.env.GT_API_KEY);
  return {
    worker,
    repository,
    documents,
    media,
    savedSettings,
    schemaFor,
    metadata,
    enqueue,
    settings: settingsResponse,
    async translationOptions(): Promise<TranslationOptionsResponse> {
      const settings = await savedSettings();
      const available = await metadata();
      return {
        configured: Boolean(
          process.env.GT_API_KEY?.trim() &&
          settings.projectId &&
          settings.targetLocales.length &&
          Object.keys(settings.contentTypes).length
        ),
        sourceLocale: settings.sourceLocale,
        targetLocales: available.locales.filter((locale) =>
          settings.targetLocales.includes(locale.code)
        ),
        contentTypes: available.contentTypes
          .filter((schema) => settings.contentTypes[schema.uid])
          .map(({ uid, localized, draftAndPublish }) => ({ uid, localized, draftAndPublish })),
        aiTranslationsEnabled: available.aiTranslationsEnabled,
        createMissingLocales: settings.createMissingLocales,
        autoPublish: settings.autoPublish,
      };
    },
    async saveSettings(input: unknown): Promise<SettingsResponse> {
      const settings = validateSettings(input, await metadata());
      await store().set({ value: settings });
      return settingsResponse();
    },
    async connection() {
      const client = await configuration(await savedSettings());
      return { project: await client.testConnection(), message: messages.connectionSuccess() };
    },
    async history(
      actorId: number,
      filters: {
        page: number;
        contentType?: string;
        documentId?: string;
        latestPerLocale?: boolean;
      }
    ) {
      const actor = await loadActorPermissions(strapi, actorId);
      if (
        !actor.plugin('translate') &&
        !actor.plugin('bulkTranslate') &&
        !actor.plugin('readSettings')
      )
        return denied();
      if (filters.latestPerLocale && (!filters.contentType || !filters.documentId))
        return fail('Choose a content type and document for per-locale history');
      const latest =
        filters.latestPerLocale && filters.contentType && filters.documentId
          ? await repository.latest(
              actorId,
              filters.contentType,
              filters.documentId,
              (await savedSettings()).targetLocales
            )
          : null;
      const result = latest
        ? { jobs: latest, total: latest.length }
        : await repository.list(actorId, filters);
      const visible: StoredJob[] = [];
      for (const job of result.jobs) {
        const { schema, components } = schemaFor(job.contentType, job.settings);
        const source = await documents.read(
          schema,
          components,
          job.documentId,
          job.sourceLocale,
          job.sourceStatus
        );
        if (source && checkContent(actor.checker(job.contentType))('read', source))
          visible.push(job);
      }
      return { jobs: visible.map(summarizeJob), total: result.total };
    },
    async retry(id: number, actorId: number) {
      const job = await repository.get(id);
      if (!job || job.actorId !== actorId) return denied();
      const fresh = await prepare(job);
      if (job.prepared && fresh.sourceHash !== job.prepared.sourceHash)
        throw new DiagnosticError(messages.staleSource());
      if (job.prepared && fresh.targetHash !== job.prepared.targetHash)
        throw new DiagnosticError(messages.humanEdit());
      return { jobs: [summarizeJob(await repository.retry(job))] };
    },
    async mediaDocument(
      contentType: string,
      documentId: string,
      locale: string,
      variant: 'draft' | 'published',
      actorId: number,
      edit?: MediaOverlayRequest
    ) {
      const settings = await savedSettings();
      const { schema, components } = schemaFor(contentType, settings);
      if (!settings.contentTypes[contentType]?.mediaMetadata)
        return fail('Enable localized media metadata for this content type');
      const document = await documents.read(schema, components, documentId, locale, variant);
      if (!document) return fail('The selected locale does not exist');
      const actor = await loadActorPermissions(strapi, actorId);
      const can = checkContent(actor.checker(contentType));
      if (
        !actor.plugin('translate') ||
        !can('read', document) ||
        (edit && !can('update', document))
      )
        return denied();
      const occurrences = mediaOccurrences(document, schema, components, settings);
      for (const occurrence of occurrences) {
        const field = permissionField(schema, components, document, occurrence.path);
        if (
          !can('read', document, field) ||
          (edit &&
            JSON.stringify(edit.path) === JSON.stringify(occurrence.path) &&
            !can('update', document, field))
        )
          return denied();
      }
      if (edit)
        return documents.transaction(schema, documentId, async () => {
          const current = await documents.read(schema, components, documentId, locale, 'draft');
          if (!current) return fail('The selected locale no longer exists');
          const currentActor = await loadActorPermissions(strapi, actorId);
          const currentPermission = checkContent(currentActor.checker(contentType));
          const field = permissionField(schema, components, current, edit.path);
          if (
            !currentActor.plugin('translate') ||
            !currentPermission('read', current, field) ||
            !currentPermission('update', current, field)
          )
            return denied();
          return media.edit(edit, schema, components, current, settings);
        });
      return media.items(schema, components, document, settings, variant);
    },
  };
};
export type PluginRuntime = ReturnType<typeof createPluginRuntime>;
