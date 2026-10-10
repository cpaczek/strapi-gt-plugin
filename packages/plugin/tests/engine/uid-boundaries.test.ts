import { describe, expect, it } from 'vitest';
import { translationEngine } from '../../server/src/engine';
import type { PrepareTranslationInput } from '../../shared/contracts';
import { articleSchema, prepareInput } from './fixtures';

const rules = { slug: { translate: true, uidStrategy: 'regenerate' as const } };
const generate = (title: string, extra: Partial<PrepareTranslationInput> = {}) => {
  const prepared = translationEngine.prepare(
    prepareInput(
      { documentId: 'document', title: 'Source', slug: 'source-slug' },
      { rules, ...extra }
    )
  );
  return translationEngine.apply(
    prepared,
    Object.fromEntries(prepared.segments.map((entry) => [entry.id, title]))
  );
};

describe('UID regeneration boundaries', () => {
  it('preserves existing ASCII punctuation and diacritic normalization', () => {
    expect(generate("Conway's Law").patch.slug).toBe('conway-s-law');
    expect(generate('A & B').patch.slug).toBe('a-b');
    expect(generate('Äpfel Öfen').patch.slug).toBe('apfel-ofen');
    expect(generate('under_score and.period').patch.slug).toBe('under-score-and-period');
  });
  it('uses stable fallbacks for nonempty emoji and punctuation-only titles', () => {
    for (const title of ['👩🏽‍🚀', '!!!', '\u0301', '\uD800']) {
      expect(generate(title).patch.slug).toMatch(/^entry-[a-f0-9]{64}$/);
      expect(generate(title).patch.slug).toBe(generate(title).patch.slug);
    }
  });
  it('normalizes equivalent unsupported titles before deriving fallback identity', () => {
    expect(generate('㍿').patch.slug).toBe(generate('株式会社').patch.slug);
    expect(generate('  株式会社  ').patch.slug).toBe(generate('株式会社').patch.slug);
  });
  it('uses source UID identity when a source document ID is unavailable', () => {
    const first = generate('末地使者', { source: { title: 'Source', slug: 'source-one' } }).patch
      .slug;
    const second = generate('末地使者', { source: { title: 'Source', slug: 'source-two' } }).patch
      .slug;
    expect(first).not.toBe(second);
    expect(
      generate('末地使者', { source: { title: 'Source', slug: 'source-one' } }).patch.slug
    ).toBe(first);
  });
  it('binds fallback identity to content type', () => {
    const first = generate('末地使者').patch.slug;
    expect(
      generate('末地使者', { schema: { ...articleSchema, uid: 'api::note.note' } }).patch.slug
    ).not.toBe(first);
  });
  it('binds fallback identity to each UID attribute path', () => {
    const result = generate('末地使者', {
      schema: {
        ...articleSchema,
        attributes: { ...articleSchema.attributes, other: { type: 'uid', targetField: 'title' } },
      },
      source: { documentId: 'document', title: 'Source', slug: 'source', other: 'source' },
      rules: { ...rules, other: { translate: true, uidStrategy: 'regenerate' } },
    });
    expect(result.patch.slug).not.toBe(result.patch.other);
  });
  it('protects a manually cleared UID after a previous translation', () => {
    const previous = generate('First');
    const result = generate('مرحبا بك', {
      source: { documentId: 'document', title: 'Changed', slug: 'source-slug' },
      target: { title: 'First', slug: '' },
      checkpoints: previous.checkpoints,
    });
    expect(result.patch).toEqual({ title: 'مرحبا بك' });
  });
  it('regenerates a human UID only when force is explicit', () => {
    const result = generate('Καλημέρα κόσμε', {
      target: { title: 'Human title', slug: 'human-slug' },
      force: true,
    });
    expect(result.patch.slug).toBe('kalimera-kosme');
  });
  it('keeps copy strategy byte-identical instead of silently regenerating', () => {
    const prepared = translationEngine.prepare(
      prepareInput(
        { slug: 'Human_Chosen.Slug~' },
        { rules: { slug: { translate: true, uidStrategy: 'copy' } } }
      )
    );
    expect(prepared.segments).toEqual([]);
    expect(translationEngine.apply(prepared, {}).patch.slug).toBe('Human_Chosen.Slug~');
  });
  it('honors the selected source field for regeneration', () => {
    const prepared = translationEngine.prepare(
      prepareInput(
        { title: 'Other title', summary: 'Chosen title', slug: 'source' },
        { rules: { slug: { translate: true, uidStrategy: 'regenerate', sourceField: 'summary' } } }
      )
    );
    const translated = Object.fromEntries(
      prepared.segments.map((entry) => [
        entry.id,
        entry.path[0] === 'summary' ? 'مرحبا بك' : 'Unrelated title',
      ])
    );
    expect(translationEngine.apply(prepared, translated).patch.slug).toBe('mrhba-bk');
  });
  it('uses separate fallback identities inside repeated components', () => {
    const prepared = translationEngine.prepare(
      prepareInput(
        {
          documentId: 'document',
          sections: [
            { __component: 'content.card', heading: 'Source', slug: 'same' },
            { __component: 'content.card', heading: 'Source', slug: 'same' },
          ],
        },
        {
          components: {
            'content.card': {
              uid: 'content.card',
              localized: false,
              draftAndPublish: false,
              attributes: {
                heading: { type: 'string' },
                slug: { type: 'uid', targetField: 'heading' },
              },
            },
          },
          rules: { 'sections.slug': { translate: true, uidStrategy: 'regenerate' } },
        }
      )
    );
    const result = translationEngine.apply(
      prepared,
      Object.fromEntries(prepared.segments.map((entry) => [entry.id, '末地使者']))
    );
    const sections = result.patch.sections;
    if (!Array.isArray(sections)) throw new Error('Expected translated sections');
    const first = sections[0];
    const second = sections[1];
    if (
      !first ||
      typeof first !== 'object' ||
      Array.isArray(first) ||
      !second ||
      typeof second !== 'object' ||
      Array.isArray(second)
    )
      throw new Error('Expected component objects');
    expect(first.slug).not.toBe(second.slug);
  });
  it('skips an unchanged machine UID and title on the next preparation', () => {
    const source = { documentId: 'document', title: 'Source', slug: 'source-slug' };
    const previous = generate('末地使者');
    const prepared = translationEngine.prepare(
      prepareInput(source, { rules, target: previous.patch, checkpoints: previous.checkpoints })
    );
    expect(prepared.segments).toEqual([]);
    expect(translationEngine.apply(prepared, {}).patch).toEqual({});
  });
});
