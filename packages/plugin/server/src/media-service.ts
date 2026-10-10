import type { Core } from '@strapi/strapi';
import { DEFAULT_SETTINGS } from '../../shared/constants';
import { z } from 'zod';
import type {
  ContentSchema,
  FieldPath,
  JsonObject,
  JsonValue,
  MediaOverlayItem,
  MediaOverlayRequest,
  MediaOverlayResponse,
  PluginSettings,
  PreparedTranslation,
  AppliedTranslation,
} from '../../shared/contracts';
import { hashValue, mediaSourceHash } from './engine';
import { atPath, assetIdentity, overlayDocument, type MediaOverlay } from './media';
import type { JobRepository, TranslationState } from './repository';
import { jsonObject, objectRecord, fail } from './validation';

export interface MediaOccurrence {
  path: FieldPath;
  asset: JsonObject;
  context?: string;
}
export const mediaOccurrences = (
  document: JsonObject,
  schema: ContentSchema,
  components: Record<string, ContentSchema>,
  settings: PluginSettings,
  path: FieldPath = [],
  inheritedContext?: string
): MediaOccurrence[] => {
  const result: MediaOccurrence[] = [];
  const configuration = settings.contentTypes[schema.uid];
  const walk = (
    entry: JsonObject,
    currentSchema: ContentSchema,
    currentPath: FieldPath,
    context?: string
  ): void => {
    for (const [name, field] of Object.entries(currentSchema.attributes)) {
      if (field.private || (currentPath.length === 0 && field.localized === false)) continue;
      const fieldPath = [...currentPath, name];
      const rule =
        configuration?.fields[fieldPath.filter((part) => typeof part === 'string').join('.')];
      if (rule?.translate === false) continue;
      const fieldContext = rule?.context ?? context;
      const value = entry[name];
      const values = Array.isArray(value) ? value : [value];
      for (const [index, child] of values.entries()) {
        if (!objectRecord(child)) continue;
        const childPath = Array.isArray(value) ? [...fieldPath, index] : fieldPath;
        if (field.type === 'media' && assetIdentity(child))
          result.push({
            path: childPath,
            asset: child,
            ...(fieldContext ? { context: fieldContext } : {}),
          });
        const componentUid = field.type === 'dynamiczone' ? child.__component : field.component;
        if (typeof componentUid === 'string' && components[componentUid])
          walk(child, components[componentUid], childPath, fieldContext);
      }
    }
  };
  walk(document, schema, path, inheritedContext);
  return result;
};
const structure = (value: JsonValue): JsonValue => {
  if (Array.isArray(value)) return value.map(structure);
  if (!objectRecord(value)) return value;
  if (assetIdentity(value) && typeof value.url === 'string')
    return { id: value.id ?? null, hash: value.hash ?? null, url: value.url };
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          !['id', 'createdAt', 'updatedAt', 'publishedAt', 'createdBy', 'updatedBy'].includes(key)
      )
      .map(([key, item]) => [key, structure(item)])
  );
};
export const mediaStructureHash = (document: JsonObject): string => hashValue(structure(document));
const sameOccurrence = (
  left: Pick<MediaOverlay, 'path' | 'property'>,
  right: Pick<MediaOverlay, 'path' | 'property'>
): boolean =>
  JSON.stringify(left.path) === JSON.stringify(right.path) && left.property === right.property;
export const preparationTarget = (
  target: JsonObject | null,
  occurrences: MediaOccurrence[],
  state: TranslationState
): JsonObject | null => {
  if (!target) return null;
  const clone = structuredClone(target);
  for (const occurrence of occurrences) {
    const asset = atPath(clone, occurrence.path);
    if (!objectRecord(asset)) continue;
    for (const property of ['alternativeText', 'caption'] as const) {
      const overlay = state.media.find(
        (item) =>
          sameOccurrence(item, { path: occurrence.path, property }) &&
          item.assetId === assetIdentity(asset) &&
          item.structureHash === mediaStructureHash(target)
      );
      asset[property] = overlay ? overlay.value : null;
    }
  }
  return clone;
};
export const appliedMedia = (
  applied: AppliedTranslation,
  document: JsonObject,
  previous: TranslationState,
  previousDocument: JsonObject | null
): MediaOverlay[] => {
  const overlays = previous.media
    .filter(
      (overlay) =>
        !applied.media.some(
          (item) =>
            JSON.stringify(item.path) === JSON.stringify(overlay.path) &&
            Object.hasOwn(item, overlay.property)
        )
    )
    .map((overlay) =>
      previousDocument &&
      overlay.structureHash === mediaStructureHash(previousDocument) &&
      assetIdentity(atPath(document, overlay.path)) === overlay.assetId
        ? { ...overlay, structureHash: mediaStructureHash(document) }
        : overlay
    );
  for (const item of applied.media) {
    if (assetIdentity(atPath(document, item.path)) !== item.assetId) continue;
    for (const property of ['alternativeText', 'caption'] as const) {
      const value = item[property];
      if (value !== undefined)
        overlays.push({
          path: item.path,
          property,
          assetId: item.assetId,
          sourceHash: item.sourceHash,
          structureHash: mediaStructureHash(document),
          value,
          origin: 'translated',
        });
    }
  }
  return overlays;
};
export const createMediaService = (strapi: Core.Strapi, repository: JobRepository) => {
  const rawAssets = async (assetIds: string[]): Promise<Map<string, JsonObject>> => {
    if (!assetIds.length) return new Map();
    const rows: unknown = await strapi.db
      .query('plugin::upload.file')
      .findMany({ where: { id: { $in: [...new Set(assetIds)] } } });
    const values = z.array(jsonObject).parse(rows);
    return new Map(
      values.flatMap((asset) => {
        const id = assetIdentity(asset);
        return id ? [[id, asset]] : [];
      })
    );
  };
  const items = async (
    schema: ContentSchema,
    components: Record<string, ContentSchema>,
    document: JsonObject,
    settings: PluginSettings,
    variant: 'draft' | 'published'
  ): Promise<MediaOverlayResponse> => {
    if (typeof document.documentId !== 'string' || typeof document.locale !== 'string')
      return fail('The document or locale is unavailable');
    const state = await repository.state(schema.uid, document.documentId, document.locale, variant);
    const occurrences = mediaOccurrences(document, schema, components, settings);
    const assets = await rawAssets(
      occurrences.flatMap((item) => {
        const id = assetIdentity(item.asset);
        return id ? [id] : [];
      })
    );
    const result: MediaOverlayItem[] = [];
    for (const occurrence of occurrences) {
      const assetId = assetIdentity(occurrence.asset);
      const asset = assetId ? assets.get(assetId) : undefined;
      if (!assetId || !asset) continue;
      for (const property of ['alternativeText', 'caption'] as const) {
        if (!Object.hasOwn(asset, property)) continue;
        const raw = asset[property];
        if (typeof raw !== 'string' && raw !== null) continue;
        const overlay = state.media.find(
          (item) =>
            sameOccurrence(item, { path: occurrence.path, property }) && item.assetId === assetId
        );
        const stale =
          overlay &&
          (overlay.sourceHash !== mediaSourceHash(asset, property, occurrence.context) ||
            overlay.structureHash !== mediaStructureHash(document));
        result.push({
          path: occurrence.path,
          assetId,
          property,
          source: raw,
          value: overlay ? overlay.value : raw,
          status: overlay ? (stale ? 'stale' : overlay.origin) : 'source',
        });
      }
    }
    return { items: result, draftAndPublish: schema.draftAndPublish };
  };
  return {
    items,
    async validatePrepared(prepared: PreparedTranslation): Promise<void> {
      if (!prepared.input.mediaMetadata) return;
      const assets = mediaOccurrences(
        prepared.input.source,
        prepared.input.schema,
        prepared.input.components,
        {
          ...DEFAULT_SETTINGS,
          contentTypes: {
            [prepared.input.schema.uid]: { fields: prepared.input.rules, mediaMetadata: true },
          },
        }
      );
      const raw = await rawAssets(
        assets.flatMap((item) => {
          const id = assetIdentity(item.asset);
          return id ? [id] : [];
        })
      );
      for (const occurrence of assets) {
        const id = assetIdentity(occurrence.asset);
        const asset = id ? raw.get(id) : undefined;
        if (!asset) return fail('A source media file is no longer available');
        for (const property of ['alternativeText', 'caption'] as const) {
          if (
            mediaSourceHash(asset, property, occurrence.context) !==
            mediaSourceHash(occurrence.asset, property, occurrence.context)
          )
            return fail('Shared media metadata changed; translate the latest source');
        }
      }
    },
    async edit(
      request: MediaOverlayRequest,
      schema: ContentSchema,
      components: Record<string, ContentSchema>,
      document: JsonObject,
      settings: PluginSettings
    ): Promise<MediaOverlayResponse> {
      const occurrence = mediaOccurrences(document, schema, components, settings).find(
        (item) => JSON.stringify(item.path) === JSON.stringify(request.path)
      );
      if (!occurrence) return fail('Select a populated media field configured for translation');
      const id = assetIdentity(occurrence.asset);
      if (!id) return fail('The media file is unavailable');
      const raw = (await rawAssets([id])).get(id);
      if (!raw) return fail('The media file is unavailable');
      const previous = await repository.state(
        schema.uid,
        request.documentId,
        request.locale,
        'draft'
      );
      const media = previous.media.filter((item) => !sameOccurrence(item, request));
      if (!request.reset)
        media.push({
          path: request.path,
          property: request.property,
          assetId: id,
          sourceHash: mediaSourceHash(raw, request.property, occurrence.context),
          structureHash: mediaStructureHash(document),
          value: request.value,
          origin: 'manual',
        });
      await repository.saveState(schema.uid, request.documentId, request.locale, 'draft', {
        ...previous,
        media,
      });
      if (!schema.draftAndPublish)
        await repository.saveState(schema.uid, request.documentId, request.locale, 'published', {
          ...previous,
          media,
        });
      return items(schema, components, document, settings, 'draft');
    },
    async decorate(
      result: unknown,
      schema: ContentSchema,
      components: Record<string, ContentSchema>,
      settings: PluginSettings
    ): Promise<unknown> {
      const documents = Array.isArray(result) ? result : result ? [result] : [];
      const valid = documents.flatMap((document) => {
        const parsed = jsonObject.safeParse(document);
        return parsed.success ? [parsed.data] : [];
      });
      const identities = valid.flatMap((document) =>
        mediaOccurrences(document, schema, components, settings).flatMap((occurrence) => {
          const id = assetIdentity(occurrence.asset);
          return id ? [id] : [];
        })
      );
      const raw = await rawAssets(identities);
      const decorated = await Promise.all(
        documents.map(async (original) => {
          const parsed = jsonObject.safeParse(original);
          if (!parsed.success) return original;
          const document = parsed.data;
          if (
            typeof document.documentId !== 'string' ||
            typeof document.locale !== 'string' ||
            (schema.draftAndPublish && !Object.hasOwn(document, 'publishedAt'))
          )
            return original;
          const state = await repository.state(
            schema.uid,
            document.documentId,
            document.locale,
            schema.draftAndPublish && !document.publishedAt ? 'draft' : 'published'
          );
          const occurrences = mediaOccurrences(document, schema, components, settings);
          const allowed = state.media.filter((overlay) =>
            occurrences.some((item) => JSON.stringify(item.path) === JSON.stringify(overlay.path))
          );
          return overlayDocument(document, allowed, {
            structureHash: mediaStructureHash,
            sourceHash: (overlay) => {
              const asset = raw.get(overlay.assetId);
              const occurrence = occurrences.find(
                (item) => JSON.stringify(item.path) === JSON.stringify(overlay.path)
              );
              return asset && occurrence
                ? mediaSourceHash(asset, overlay.property, occurrence.context)
                : null;
            },
          });
        })
      );
      return Array.isArray(result) ? decorated : result ? decorated[0] : result;
    },
  };
};
