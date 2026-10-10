import { createHash } from 'node:crypto';
import type { JsonObject, JsonValue } from '../../../shared/contracts';
import { invalidTranslation } from './errors';

export const isObject = (value: JsonValue | undefined): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const canonical = (value: JsonValue): string => {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw invalidTranslation('Content contains a number that cannot be stored as JSON');
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key] ?? null)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

export const hashValue = (value: JsonValue): string =>
  createHash('sha256').update(canonical(value)).digest('hex');

export const mediaSourceHash = (
  asset: JsonObject,
  property: 'alternativeText' | 'caption',
  context?: string
): string =>
  hashValue({
    id: asset.id ?? null,
    documentId: asset.documentId ?? null,
    hash: asset.hash ?? null,
    url: asset.url ?? null,
    property,
    present: Object.hasOwn(asset, property),
    value: asset[property] ?? null,
    context: context ?? null,
  });
