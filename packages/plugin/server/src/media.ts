import type { FieldPath, JsonObject, JsonValue } from '../../shared/contracts';
import { z } from 'zod';
import { objectRecord } from './validation';

export interface MediaOverlay {
  path: FieldPath;
  assetId: string;
  property: 'alternativeText' | 'caption';
  sourceHash: string;
  structureHash: string;
  value: string | null;
  origin: 'translated' | 'manual';
}
export const overlaySchema: z.ZodType<MediaOverlay> = z.object({
  path: z.array(z.union([z.string(), z.number().int().nonnegative()])),
  assetId: z.string(),
  property: z.enum(['alternativeText', 'caption']),
  sourceHash: z.string(),
  structureHash: z.string(),
  value: z.string().nullable(),
  origin: z.enum(['translated', 'manual']),
});
export const atPath = (value: JsonValue, path: FieldPath): JsonValue | undefined => {
  let current: JsonValue | undefined = value;
  for (const part of path) {
    if (Array.isArray(current) && typeof part === 'number') current = current[part];
    else if (objectRecord(current) && typeof part === 'string') current = current[part];
    else return undefined;
  }
  return current;
};
export const assetIdentity = (asset: JsonValue | undefined): string | null => {
  if (!objectRecord(asset)) return null;
  const id = asset.id;
  return typeof id === 'string' || typeof id === 'number' ? String(id) : null;
};
interface OverlayValidation {
  sourceHash(overlay: MediaOverlay): string | null;
  structureHash(document: JsonObject, overlay: MediaOverlay): string;
}
export const overlayDocument = (
  document: JsonObject,
  overlays: readonly MediaOverlay[],
  validation: OverlayValidation
): JsonObject => {
  const result: JsonObject = structuredClone(document);
  for (const overlay of overlays) {
    const asset = atPath(result, overlay.path);
    if (
      !objectRecord(asset) ||
      assetIdentity(asset) !== overlay.assetId ||
      !Object.hasOwn(asset, overlay.property)
    )
      continue;
    if (
      validation.sourceHash(overlay) !== overlay.sourceHash ||
      validation.structureHash(document, overlay) !== overlay.structureHash
    )
      continue;
    asset[overlay.property] = overlay.value;
  }
  return result;
};
