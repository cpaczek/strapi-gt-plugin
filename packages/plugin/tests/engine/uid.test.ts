import { describe, expect, it } from 'vitest';
import { translationEngine } from '../../server/src/engine';
import { prepareInput } from './fixtures';

const rules = { slug: { translate: true, uidStrategy: 'regenerate' as const } };
const translateTitle = (title: string, documentId = 'document-one') => {
  const prepared = translationEngine.prepare(
    prepareInput({ documentId, title: 'English title', slug: 'source-slug' }, { rules })
  );
  const result = translationEngine.apply(
    prepared,
    Object.fromEntries(prepared.segments.map((entry) => [entry.id, title]))
  );
  return result;
};

describe('publishable regenerated UIDs', () => {
  it.each([
    ['مرحبا بك', 'mrhba-bk'],
    ['Καλημέρα κόσμε', 'kalimera-kosme'],
    ['A quiet interview', 'a-quiet-interview'],
    ['Déjà Vu', 'deja-vu'],
    ['Crème Brûlée', 'creme-brulee'],
    ['fooBar', 'foobar'],
  ])('transliterates %s to a Strapi-compatible slug', (title, expected) => {
    expect(translateTitle(title).patch.slug).toBe(expected);
  });
  it.each(['末地使者', 'こんにちは', '안녕하세요'])(
    'uses a deterministic ASCII fallback for %s',
    (title) => {
      const first = translateTitle(title).patch.slug;
      expect(first).toMatch(/^entry-[a-f0-9]{64}$/);
      expect(translateTitle(title).patch.slug).toBe(first);
    }
  );
  it('keeps fallback identities distinct across titles and documents', () => {
    const first = translateTitle('末地使者', 'document-one').patch.slug;
    expect(translateTitle('末地使者', 'document-two').patch.slug).not.toBe(first);
    expect(translateTitle('末地访客', 'document-one').patch.slug).not.toBe(first);
  });
  it.each(['', '   ', '\t\n'])('rejects an empty translated title %#', (title) => {
    expect(() => translateTitle(title)).toThrow();
  });
  it('does not send UID text to GT', () => {
    const prepared = translationEngine.prepare(
      prepareInput({ title: 'English title', slug: 'must-not-send' }, { rules })
    );
    expect(prepared.segments.map((entry) => entry.text)).toEqual(['English title']);
    expect(prepared.segments.map((entry) => entry.path)).toEqual([['title']]);
  });
  it('protects a manually edited UID while translating the title', () => {
    const initial = translateTitle('First title');
    const prepared = translationEngine.prepare(
      prepareInput(
        { title: 'Changed title', slug: 'source-slug' },
        {
          rules,
          checkpoints: initial.checkpoints,
          target: { title: 'First title', slug: 'editor-owned-slug' },
        }
      )
    );
    expect(prepared.protectedPaths).toContain('["slug"]');
    expect(
      translationEngine.apply(
        prepared,
        Object.fromEntries(prepared.segments.map((entry) => [entry.id, 'مرحبا بك']))
      ).patch
    ).toEqual({ title: 'مرحبا بك' });
  });
});
