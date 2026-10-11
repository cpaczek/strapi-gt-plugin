import slugify from '@sindresorhus/slugify';
import type {
  AppliedTranslation,
  ContentSchema,
  FieldPath,
  FieldRule,
  FieldSchema,
  JsonObject,
  JsonValue,
  PrepareTranslationInput,
  PreparedTranslation,
  TranslationEngine,
  TranslationSegment,
} from '../../../shared/contracts';
import { MAX_SOURCE_BYTES, UID_FALLBACK_PREFIX } from '../../../shared/constants';
import { messages } from '../../../shared/messages';
import { GtRequestError, invalidTranslation } from './errors';
import { hashValue, isObject, mediaSourceHash } from './hash';
import { markdownSpans, replaceMarkdown } from './markdown';

interface FieldUnit {
  path: FieldPath;
  value: JsonValue;
  field: FieldSchema;
  rule?: FieldRule;
  context?: string;
  segments: TranslationSegment[];
  sourceHash: string;
  uidSourceField?: FieldSchema;
  media?: { asset: JsonObject; path: FieldPath; property: 'alternativeText' | 'caption' };
}

const pathKey = (path: FieldPath): string => JSON.stringify(path);
const own = (value: JsonObject, key: string): JsonValue | undefined =>
  Object.hasOwn(value, key) ? value[key] : undefined;
const atPath = (value: JsonValue | undefined, path: FieldPath): JsonValue | undefined => {
  let cursor = value;
  for (const part of path) {
    if (typeof part === 'number' && Array.isArray(cursor)) cursor = cursor[part];
    else if (typeof part === 'string' && isObject(cursor)) cursor = own(cursor, part);
    else return undefined;
  }
  return cursor;
};
const put = (object: JsonObject, key: string, value: JsonValue): void => {
  Object.defineProperty(object, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
};
const setPath = (root: JsonObject, path: FieldPath, value: JsonValue): void => {
  const key = path.at(-1);
  const parent = atPath(root, path.slice(0, -1));
  if (typeof key === 'number' && Array.isArray(parent)) parent[key] = value;
  else if (typeof key === 'string' && isObject(parent)) put(parent, key, value);
  else throw invalidTranslation('The translated field no longer has a matching content structure');
};
const empty = (value: JsonValue | undefined): boolean =>
  value === undefined ||
  value === null ||
  value === '' ||
  (Array.isArray(value) && value.length === 0);
const assetId = (asset: JsonObject): string | undefined =>
  typeof asset.id === 'number' || typeof asset.id === 'string' ? String(asset.id) : undefined;

const collect = (
  input: PrepareTranslationInput
): { units: FieldUnit[]; protectedPaths: string[] } => {
  const units: FieldUnit[] = [];
  const protectedPaths: string[] = [];
  const add = (
    path: FieldPath,
    value: JsonValue,
    field: FieldSchema,
    rule: FieldRule | undefined,
    context: string | undefined,
    media?: FieldUnit['media'],
    uidSourceField?: FieldSchema
  ): void => {
    const segments: TranslationSegment[] = [];
    const segment = (
      text: string,
      subpath: FieldPath,
      suffix: JsonValue,
      kind: TranslationSegment['kind']
    ): void => {
      if (!text.trim()) return;
      segments.push({
        id: hashValue([pathKey(subpath), suffix]),
        path: subpath,
        text,
        kind,
        ...(context !== undefined ? { context } : {}),
      });
    };
    if (field.type === 'richtext' && typeof value === 'string') {
      for (const span of markdownSpans(value)) segment(span.text, path, span.start, 'markdown');
    } else if (field.type === 'blocks') {
      const visit = (node: JsonValue, nodePath: FieldPath): void => {
        if (Array.isArray(node)) node.forEach((child, index) => visit(child, [...nodePath, index]));
        else if (isObject(node)) {
          if (node.type === 'code' || node.type === 'image') return;
          if (node.type === 'text' && typeof node.text === 'string')
            segment(node.text, [...nodePath, 'text'], null, 'text');
          else if (Array.isArray(node.children)) visit(node.children, [...nodePath, 'children']);
        }
      };
      visit(value, path);
    } else if (field.type !== 'uid' && typeof value === 'string') {
      segment(
        value,
        path,
        null,
        media?.property === 'alternativeText' ? 'media-alt' : media ? 'media-caption' : 'text'
      );
    }
    const sourceHash = media
      ? mediaSourceHash(media.asset, media.property, context)
      : hashValue({
          value,
          context: context ?? null,
          type: field.type,
          uidStrategy: rule?.uidStrategy ?? null,
          sourceField: rule?.sourceField ?? field.targetField ?? null,
          uidSource:
            field.type === 'uid'
              ? (atPath(input.source, [
                  ...path.slice(0, -1),
                  rule?.sourceField ?? field.targetField ?? '',
                ]) ?? null)
              : null,
        });
    units.push({
      path,
      value,
      field,
      rule,
      context,
      segments,
      sourceHash,
      ...(uidSourceField ? { uidSourceField } : {}),
      ...(media ? { media } : {}),
    });
  };
  const walk = (
    schema: ContentSchema,
    source: JsonObject,
    path: FieldPath,
    nested: boolean,
    inheritedContext?: string
  ): void => {
    for (const [name, field] of Object.entries(schema.attributes)) {
      const value = own(source, name);
      const fieldPath = [...path, name];
      const ruleKey = fieldPath.filter((part) => typeof part === 'string').join('.');
      const rule = input.rules[pathKey(fieldPath)] ?? input.rules[ruleKey];
      const context = rule?.context ?? inheritedContext;
      if (
        field.private ||
        (nested ? field.localized === false : field.localized !== true && field.type !== 'uid') ||
        rule?.translate === false ||
        value === undefined
      )
        continue;
      if (value === null) {
        if (['string', 'text', 'richtext', 'blocks'].includes(field.type))
          add(fieldPath, value, field, rule, context);
        continue;
      }
      if (field.type === 'component' || field.type === 'dynamiczone') {
        const target = atPath(input.target, fieldPath);
        const shape = (candidate: JsonValue | undefined): JsonValue =>
          Array.isArray(candidate)
            ? candidate.map((item) => (isObject(item) ? (item.__component ?? 'component') : null))
            : isObject(candidate)
              ? (candidate.__component ?? 'component')
              : null;
        if (!empty(target) && hashValue(shape(value)) !== hashValue(shape(target))) {
          protectedPaths.push(pathKey(fieldPath));
          continue;
        }
        const entries = Array.isArray(value) ? value : [value];
        entries.forEach((entry, index) => {
          if (!isObject(entry)) return;
          const component = field.type === 'dynamiczone' ? entry.__component : field.component;
          if (
            typeof component !== 'string' ||
            (field.type === 'dynamiczone' && !field.components?.includes(component))
          )
            return;
          const componentSchema = input.components[component];
          if (!componentSchema)
            throw invalidTranslation('A configured component schema is unavailable');
          walk(
            componentSchema,
            entry,
            Array.isArray(value) ? [...fieldPath, index] : fieldPath,
            true,
            context
          );
        });
      } else if (field.type === 'media' && input.mediaMetadata) {
        const assets = Array.isArray(value) ? value : [value];
        assets.forEach((asset, index) => {
          if (!isObject(asset) || !assetId(asset)) return;
          const mediaPath = Array.isArray(value) ? [...fieldPath, index] : fieldPath;
          const target = atPath(input.target, mediaPath);
          if (isObject(target) && assetId(target) !== assetId(asset)) {
            protectedPaths.push(pathKey(mediaPath));
            return;
          }
          for (const property of ['alternativeText', 'caption'] as const) {
            const text = asset[property];
            if (typeof text === 'string' && text.trim())
              add([...mediaPath, property], text, field, rule, context, {
                asset,
                path: mediaPath,
                property,
              });
          }
        });
      } else if (['string', 'text', 'richtext'].includes(field.type) && typeof value === 'string') {
        add(fieldPath, value, field, rule, context);
      } else if (field.type === 'blocks' && Array.isArray(value)) {
        add(fieldPath, value, field, rule, context);
      } else if (field.type === 'uid' && rule?.translate && typeof value === 'string') {
        add(
          fieldPath,
          value,
          field,
          rule,
          context,
          undefined,
          schema.attributes[rule.sourceField ?? field.targetField ?? '']
        );
      }
    }
  };
  if (input.schema.localized) walk(input.schema, input.source, [], false);
  return { units, protectedPaths };
};

const select = (
  input: PrepareTranslationInput
): { units: FieldUnit[]; protectedPaths: string[]; unchangedPaths: string[] } => {
  const found = collect(input);
  const unchangedPaths: string[] = [];
  const units = found.units.filter((unit) => {
    const key = pathKey(unit.path);
    const checkpoint = input.checkpoints[key];
    const target = atPath(input.target, unit.path);
    if (unit.value === null && !checkpoint && (target === undefined || target === null))
      return false;
    const targetHash = hashValue(target ?? null);
    if (!input.force && (checkpoint ? targetHash !== checkpoint.targetHash : !empty(target))) {
      // Raw shared upload metadata is not a human-created localized overlay.
      if (checkpoint || !unit.media || hashValue(target ?? null) !== hashValue(unit.value)) {
        found.protectedPaths.push(key);
        return false;
      }
    }
    if (
      !input.force &&
      checkpoint?.sourceHash === unit.sourceHash &&
      checkpoint.targetHash === targetHash
    ) {
      unchangedPaths.push(key);
      return false;
    }
    return true;
  });
  return { units, protectedPaths: found.protectedPaths, unchangedPaths };
};

const relationValue = (value: JsonValue): JsonValue => {
  if (Array.isArray(value)) return value.map(relationValue);
  if (isObject(value)) return value.documentId ?? value.id ?? null;
  return value;
};

const sourceValue = (
  field: FieldSchema,
  value: JsonValue,
  components: Record<string, ContentSchema>
): JsonValue => {
  if (field.type === 'media') {
    if (Array.isArray(value))
      return value.map((asset) => (isObject(asset) ? (asset.id ?? null) : asset));
    return isObject(value) ? (value.id ?? null) : value;
  }
  if (field.type === 'relation') return relationValue(value);
  if (field.type !== 'component' && field.type !== 'dynamiczone') return structuredClone(value);
  const cloneComponent = (entry: JsonValue): JsonValue => {
    if (!isObject(entry)) return entry;
    const component = field.type === 'dynamiczone' ? entry.__component : field.component;
    if (typeof component !== 'string' || !components[component])
      throw invalidTranslation('A component cannot be reconstructed without its schema');
    const result: JsonObject = {};
    if (field.type === 'dynamiczone') put(result, '__component', component);
    for (const [key, child] of Object.entries(components[component].attributes)) {
      const childValue = own(entry, key);
      if (!child.private && childValue !== undefined)
        put(result, key, sourceValue(child, childValue, components));
    }
    return result;
  };
  return Array.isArray(value) ? value.map(cloneComponent) : cloneComponent(value);
};

const prepare = (input: PrepareTranslationInput): PreparedTranslation => {
  if (Buffer.byteLength(JSON.stringify(input.source), 'utf8') > MAX_SOURCE_BYTES)
    throw invalidTranslation('The source document exceeds the translation size limit');
  const snapshot = structuredClone(input);
  const selected = select(snapshot);
  return {
    input: snapshot,
    sourceHash: hashValue(snapshot.source),
    targetHash: hashValue(snapshot.target),
    segments: selected.units.flatMap((unit) => unit.segments),
    protectedPaths: selected.protectedPaths,
    unchangedPaths: selected.unchangedPaths,
  };
};

const apply = (
  prepared: PreparedTranslation,
  translations: Record<string, string>
): AppliedTranslation => {
  const { input } = prepared;
  if (
    hashValue(input.source) !== prepared.sourceHash ||
    hashValue(input.target) !== prepared.targetHash
  )
    throw new GtRequestError(messages.staleSource());
  const { units } = select(input);
  const expected = units.flatMap((unit) => unit.segments);
  if (
    hashValue(
      expected
        .map((entry) => ({ ...entry, path: [...entry.path] }))
        .sort((left, right) => left.id.localeCompare(right.id))
    ) !==
    hashValue(
      prepared.segments
        .map((entry) => ({ ...entry, path: [...entry.path] }))
        .sort((left, right) => left.id.localeCompare(right.id))
    )
  )
    throw invalidTranslation('The saved translation segments no longer match the source snapshot');
  if (
    Object.keys(translations).length !== expected.length ||
    expected.some(
      (entry) =>
        !Object.hasOwn(translations, entry.id) || typeof translations[entry.id] !== 'string'
    )
  )
    throw invalidTranslation('GT returned missing, extra or invalid translated text');
  const result: AppliedTranslation = {
    patch: {},
    checkpoints: { ...input.checkpoints },
    media: [],
    readDependencies: [],
  };
  const sourceCopies: FieldPath[] = [];
  const writtenPaths = new Set<string>();
  const write = (unit: FieldUnit, value: JsonValue): void => {
    const top = unit.path[0];
    if (typeof top !== 'string')
      throw invalidTranslation('A translated field has no content attribute');
    if (!Object.hasOwn(result.patch, top)) {
      const target = own(input.target ?? {}, top);
      const source = own(input.source, top);
      const field = input.schema.attributes[top];
      if (source === undefined || !field)
        throw invalidTranslation('A translated field has no source attribute');
      put(
        result.patch,
        top,
        !empty(target) && target !== undefined
          ? structuredClone(target)
          : sourceValue(field, source, input.components)
      );
      if (empty(target)) sourceCopies.push([top]);
    }
    for (let depth = 1; depth < unit.path.length; depth += 1) {
      const ancestor = unit.path.slice(0, depth);
      if (empty(atPath(result.patch, ancestor))) {
        const field = input.schema.attributes[top];
        const source = own(input.source, top);
        if (!field || source === undefined)
          throw invalidTranslation('The component source is unavailable');
        const template = sourceValue(field, source, input.components);
        const branch = atPath(template, ancestor.slice(1));
        if (branch === undefined)
          throw invalidTranslation('The component path is unavailable in the source');
        setPath(result.patch, ancestor, branch);
        sourceCopies.push(ancestor);
      }
    }
    setPath(result.patch, unit.path, value);
    writtenPaths.add(pathKey(unit.path));
  };
  for (const unit of units.filter((entry) => entry.field.type !== 'uid')) {
    const translated = unit.segments.map((entry) => {
      const value = translations[entry.id];
      if (value === undefined) throw invalidTranslation('A translated segment is missing');
      return value;
    });
    let value: JsonValue = unit.value;
    if (unit.field.type === 'richtext' && typeof unit.value === 'string')
      value = replaceMarkdown(unit.value, markdownSpans(unit.value), translated);
    else if (unit.field.type === 'blocks' && Array.isArray(unit.value)) {
      const wrapper: JsonObject = { blocks: structuredClone(unit.value) };
      unit.segments.forEach((entry, index) =>
        setPath(wrapper, ['blocks', ...entry.path.slice(unit.path.length)], translated[index] ?? '')
      );
      value = wrapper.blocks ?? [];
    } else if (translated.length) value = translated[0] ?? '';
    if (unit.media && typeof value === 'string') {
      const id = assetId(unit.media.asset);
      if (!id) throw invalidTranslation('Translated media metadata has no asset identity');
      result.media.push({
        path: unit.media.path,
        assetId: id,
        sourceHash: unit.sourceHash,
        [unit.media.property]: value,
      });
    } else write(unit, value);
    result.checkpoints[pathKey(unit.path)] = {
      sourceHash: unit.sourceHash,
      targetHash: hashValue(value),
    };
  }
  for (const unit of units.filter((entry) => entry.field.type === 'uid')) {
    let value = unit.value;
    if (unit.rule?.uidStrategy === 'regenerate') {
      const sourceField = unit.rule.sourceField ?? unit.field.targetField;
      const sibling = sourceField ? [...unit.path.slice(0, -1), sourceField] : [];
      if (
        !unit.uidSourceField ||
        unit.uidSourceField.private ||
        unit.uidSourceField.localized === false ||
        !['string', 'text', 'richtext'].includes(unit.uidSourceField.type)
      )
        throw invalidTranslation('A slug must use a nonprivate localized text source field');
      const patchTitle = atPath(result.patch, sibling);
      const title = patchTitle !== undefined ? patchTitle : atPath(input.target, sibling);
      if (typeof title !== 'string')
        throw invalidTranslation('A slug cannot be generated without its translated source field');
      const normalizedTitle = title.normalize('NFKC').trim();
      if (!normalizedTitle)
        throw invalidTranslation('The translated title cannot produce a nonempty slug');
      const fromSource =
        patchTitle !== undefined &&
        (writtenPaths.has(pathKey(sibling)) ||
          sourceCopies.some((path) => path.every((part, index) => sibling[index] === part)));
      result.readDependencies.push({ document: fromSource ? 'source' : 'target', path: sibling });
      const letters = normalizedTitle
        .normalize('NFKD')
        .replace(/\p{M}+/gu, '')
        .replace(/[^\p{L}\p{N}]+/gu, ' ');
      value = slugify(letters, { decamelize: false });
      if (!value) {
        value = `${UID_FALLBACK_PREFIX}-${hashValue({
          title: normalizedTitle,
          contentType: input.schema.uid,
          document: input.source.documentId ?? unit.value,
          path: [...unit.path],
        })}`;
      }
    }
    write(unit, value);
    result.checkpoints[pathKey(unit.path)] = {
      sourceHash: unit.sourceHash,
      targetHash: hashValue(value),
    };
  }
  return result;
};

export const translationEngine: TranslationEngine = { prepare, apply };
