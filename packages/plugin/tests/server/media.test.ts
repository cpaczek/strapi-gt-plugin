import { describe, expect, it } from 'vitest';
import { overlayDocument } from '../../server/src/media';

const document = {
  documentId: 'doc',
  locale: 'fr',
  publishedAt: null,
  image: { id: 3, alternativeText: 'Original', caption: 'Caption' },
  title: 'Titre',
};
const record = {
  path: ['image'],
  assetId: '3',
  property: 'alternativeText',
  sourceHash: 'raw',
  structureHash: 'structure',
  value: 'Traduit',
  origin: 'translated',
} as const;
const options = { sourceHash: () => 'raw', structureHash: () => 'structure' };

describe('localized media delivery', () => {
  it('clones localized metadata without changing shared source objects', () => {
    const result = overlayDocument(document, [record], options);
    expect(result.image).toEqual({ ...document.image, alternativeText: 'Traduit' });
    expect(document.image.alternativeText).toBe('Original');
  });
  it('suppresses a stale shared-asset translation', () =>
    expect(
      overlayDocument(document, [record], { ...options, sourceHash: () => 'changed' }).image
    ).toEqual(document.image));
  it('suppresses a moved occurrence', () =>
    expect(
      overlayDocument(document, [record], { ...options, structureHash: () => 'reordered' }).image
    ).toEqual(document.image));
  it('preserves intentionally empty alt text', () =>
    expect(overlayDocument(document, [{ ...record, value: '' }], options).image).toEqual({
      ...document.image,
      alternativeText: '',
    }));
  it('does not add an excluded metadata property', () =>
    expect(overlayDocument({ ...document, image: { id: 3 } }, [record], options).image).toEqual({
      id: 3,
    }));
  it('does not attach metadata to a replaced asset', () =>
    expect(
      overlayDocument({ ...document, image: { ...document.image, id: 4 } }, [record], options).image
    ).toEqual({ ...document.image, id: 4 }));
  it('does not populate an unpopulated relation', () =>
    expect(overlayDocument({ ...document, image: 3 }, [record], options).image).toBe(3));
});
