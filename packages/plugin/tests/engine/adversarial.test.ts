import { describe, expect, it } from 'vitest';
import { fromMarkdown } from 'mdast-util-from-markdown';
import {
  hashValue,
  mediaSourceHash,
  resolveGtLocale,
  retryDelay,
  translationEngine,
} from '../../server/src/engine';
import { MAX_SOURCE_BYTES } from '../../shared/constants';
import type { JsonObject, JsonValue } from '../../shared/contracts';
import { articleSchema, identity, prepareInput } from './fixtures';

const { prepare, apply } = translationEngine;
const translated = (source: JsonObject, target: string) => {
  const prepared = prepare(prepareInput(source));
  return apply(prepared, Object.fromEntries(prepared.segments.map((entry) => [entry.id, target])));
};

describe('adversarial serialization', () => {
  it('keeps empty, whitespace-only and null values without paid translation', () => {
    const prepared = prepare(prepareInput({ title: '', summary: '  ', body: null, blocks: [] }));
    expect(prepared.segments).toEqual([]);
    expect(apply(prepared, {}).patch).toEqual({ title: '', summary: '  ', blocks: [] });
  });
  it('ignores unsupported kinds and a content type without localization', () => {
    expect(
      prepare(prepareInput({ title: 'Source' }, { schema: { ...articleSchema, localized: false } }))
        .segments
    ).toEqual([]);
    const attributes = {
      opaque: { type: 'json' as const, localized: true },
      mail: { type: 'email' as const, localized: true },
      state: { type: 'enumeration' as const, localized: true },
    };
    expect(
      prepare(
        prepareInput(
          { opaque: { text: 'Secret' }, mail: 'a@example.com', state: 'ready' },
          { schema: { ...articleSchema, attributes } }
        )
      ).segments
    ).toEqual([]);
  });
  it('honors disabled parents, nested leaves, and private component fields', () => {
    const source = { card: { heading: 'Source', cards: [{ heading: 'Inner' }] } };
    expect(
      prepare(prepareInput(source, { rules: { card: { translate: false } } })).segments
    ).toEqual([]);
    expect(
      prepare(
        prepareInput(source, { rules: { 'card.heading': { translate: false } } })
      ).segments.map((entry) => entry.text)
    ).toEqual(['Inner']);
  });
  it('preserves Unicode and RTL strings at deeply nested leaves', () => {
    let card: JsonObject = { heading: 'שלום 👩🏽‍🚀 e\u0301 العربية' };
    for (let depth = 0; depth < 35; depth += 1) card = { cards: [card] };
    const prepared = prepare(prepareInput({ card }));
    expect(prepared.segments).toHaveLength(1);
    expect(apply(prepared, identity(prepared.segments)).patch).toEqual({ card });
  });
  it('preserves code, autolinks, HTML and reference destinations', () => {
    const body =
      '<https://example.com>\n\n`source code`\n\n    indented code\n\n<div>raw html</div>\n\n[label][id]\n\n[id]: /destination "Title"\n';
    const prepared = prepare(prepareInput({ body }));
    expect(prepared.segments.map((entry) => entry.text)).toEqual(['label']);
    expect(apply(prepared, identity(prepared.segments)).patch.body).toBe(body);
  });
  it('prevents provider text from injecting links or Markdown syntax', () => {
    const prepared = prepare(prepareInput({ body: '**Original** [Label](/safe)' }));
    const replacements = Object.fromEntries(
      prepared.segments.map((entry) => [
        entry.id,
        '[attack](javascript:bad) **bold** `code` <script> &amp;',
      ])
    );
    const body = apply(prepared, replacements).patch.body;
    expect(typeof body).toBe('string');
    if (typeof body !== 'string') throw new Error('Expected Markdown output');
    const tree = fromMarkdown(body);
    const paragraph = tree.children[0];
    expect(paragraph?.type).toBe('paragraph');
    if (paragraph?.type !== 'paragraph') throw new Error('Expected paragraph');
    expect(paragraph.children.map((entry) => entry.type)).toEqual(['strong', 'text', 'link']);
    const link = paragraph.children[2];
    if (link?.type !== 'link') throw new Error('Expected original link');
    expect(link.url).toBe('/safe');
    expect(link.children).toHaveLength(1);
  });
  it('rejects Markdown translations that introduce new block boundaries', () => {
    const prepared = prepare(prepareInput({ body: 'Hello' }));
    expect(() =>
      apply(
        prepared,
        Object.fromEntries(prepared.segments.map((entry) => [entry.id, 'Hello\n# Injected']))
      )
    ).toThrow();
  });
  it('keeps Blocks code and image payloads outside translation requests', () => {
    const blocks = [
      { type: 'code', children: [{ type: 'text', text: 'const code = 1;' }] },
      {
        type: 'image',
        image: { alternativeText: 'Not a media field', url: '/a.png' },
        children: [{ type: 'text', text: '' }],
      },
    ];
    const prepared = prepare(prepareInput({ blocks }));
    expect(prepared.segments).toEqual([]);
    expect(apply(prepared, {}).patch.blocks).toEqual(blocks);
  });
  it('protects changed zone shapes even if force is requested', () => {
    const source = { sections: [{ __component: 'content.card', heading: 'Source' }] };
    const target = {
      sections: [
        { __component: 'content.card', heading: 'Human' },
        { __component: 'content.card', heading: 'Other' },
      ],
    };
    const prepared = prepare(prepareInput(source, { target, force: true }));
    expect(prepared.protectedPaths).toEqual(['["sections"]']);
    expect(apply(prepared, {}).patch).toEqual({});
  });
  it('initializes empty target zones with source structure and no source component IDs', () => {
    const prepared = prepare(
      prepareInput(
        { sections: [{ id: 3, __component: 'content.card', heading: 'Hello' }] },
        { target: { sections: [] } }
      )
    );
    expect(apply(prepared, identity(prepared.segments)).patch).toEqual({
      sections: [{ __component: 'content.card', heading: 'Hello' }],
    });
  });
  it('creates a missing nested target component while preserving sibling target fields', () => {
    const prepared = prepare(
      prepareInput(
        { card: { heading: 'Parent', count: 5, cards: [{ id: 7, heading: 'Child' }] } },
        { target: { card: { heading: '', count: 9 } } }
      )
    );
    expect(apply(prepared, identity(prepared.segments)).patch).toEqual({
      card: { heading: 'Parent', count: 9, cards: [{ heading: 'Child' }] },
    });
  });
  it('keeps prototype-like field names as ordinary own properties', () => {
    const source: JsonObject = JSON.parse('{"__proto__":"Hello","constructor":"World"}');
    const schema = {
      ...articleSchema,
      attributes: Object.fromEntries(
        ['__proto__', 'constructor'].map((name) => [
          name,
          { type: 'string' as const, localized: true },
        ])
      ),
    };
    const prepared = prepare(prepareInput(source, { schema }));
    expect(prepared.segments).toHaveLength(2);
    const patch = apply(prepared, identity(prepared.segments)).patch;
    expect(Object.hasOwn(patch, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(patch)).toBe(Object.prototype);
  });
  it('does not mistake dotted names for nested field paths', () => {
    const schema = {
      ...articleSchema,
      attributes: {
        ...articleSchema.attributes,
        'card.heading': { type: 'string' as const, localized: true },
      },
    };
    const prepared = prepare(
      prepareInput({ 'card.heading': 'Flat', card: { heading: 'Nested' } }, { schema })
    );
    expect(new Set(prepared.segments.map((entry) => entry.id)).size).toBe(2);
    expect(apply(prepared, identity(prepared.segments)).patch).toEqual({
      'card.heading': 'Flat',
      card: { heading: 'Nested' },
    });
  });
  it('rejects oversized source content before preparing remote segments', () => {
    expect(() => prepare(prepareInput({ title: 'x'.repeat(MAX_SOURCE_BYTES) }))).toThrow();
  });
  it('fails closed when a declared component schema is missing', () => {
    expect(() =>
      prepare(prepareInput({ card: { heading: 'Hello' } }, { components: {} }))
    ).toThrow();
  });
});

describe('adversarial checkpoints and metadata', () => {
  it('treats a human-cleared target as an edit', () => {
    const first = translated({ title: 'Source' }, 'Machine');
    const prepared = prepare(
      prepareInput({ title: 'New' }, { target: { title: '' }, checkpoints: first.checkpoints })
    );
    expect(prepared.protectedPaths).toEqual(['["title"]']);
    expect(apply(prepared, {}).patch).toEqual({});
  });
  it('clears old machine output when the source is cleared', () => {
    const first = translated({ title: 'Source' }, 'Machine');
    const prepared = prepare(
      prepareInput({ title: '' }, { target: { title: 'Machine' }, checkpoints: first.checkpoints })
    );
    expect(prepared.segments).toEqual([]);
    expect(apply(prepared, {}).patch.title).toBe('');
  });
  it('sends only the changed nested field', () => {
    const source = { card: { heading: 'First', cards: [{ heading: 'Second' }] } };
    const first = prepare(prepareInput(source));
    const output = apply(first, identity(first.segments));
    const prepared = prepare(
      prepareInput(
        { card: { heading: 'Changed', cards: [{ heading: 'Second' }] } },
        { target: output.patch, checkpoints: output.checkpoints }
      )
    );
    expect(prepared.segments.map((entry) => entry.text)).toEqual(['Changed']);
    expect(apply(prepared, identity(prepared.segments)).patch.card).toEqual({
      heading: 'Changed',
      cards: [{ heading: 'Second' }],
    });
  });
  it('snapshots caller-owned inputs and never mutates source or target', () => {
    const input = prepareInput({ title: 'Hello' }, { target: { title: '' } });
    const prepared = prepare(input);
    input.source.title = 'Caller mutation';
    expect(apply(prepared, identity(prepared.segments)).patch.title).toBe('Hello');
    expect(input.target?.title).toBe('');
  });
  it('rejects target mutation and persisted segment tampering', () => {
    const prepared = prepare(prepareInput({ title: 'Hello' }, { target: { title: '' } }));
    if (prepared.input.target) prepared.input.target.title = 'Human edit';
    expect(() => apply(prepared, identity(prepared.segments))).toThrow();
    const other = prepare(prepareInput({ title: 'Hello' }));
    if (other.segments[0]) other.segments[0].text = 'Tampered';
    expect(() => apply(other, identity(other.segments))).toThrow();
  });
  it('keeps media opt-out, missing metadata and decorative empty alt text unchanged', () => {
    const photo = { id: 2, alternativeText: '', caption: null };
    expect(prepare(prepareInput({ photo })).segments).toEqual([]);
    const prepared = prepare(prepareInput({ photo }, { mediaMetadata: true }));
    expect(apply(prepared, {}).media).toEqual([]);
  });
  it('hashes each media property independently and distinguishes missing, null, and empty', () => {
    const asset = { id: 1, alternativeText: 'Bird', caption: 'Old' };
    expect(mediaSourceHash(asset, 'alternativeText')).toBe(
      mediaSourceHash({ ...asset, caption: 'New' }, 'alternativeText')
    );
    expect(mediaSourceHash(asset, 'caption')).not.toBe(
      mediaSourceHash({ ...asset, caption: 'New' }, 'caption')
    );
    expect(mediaSourceHash({ id: 1 }, 'caption')).not.toBe(
      mediaSourceHash({ id: 1, caption: null }, 'caption')
    );
    expect(mediaSourceHash({ id: 1, caption: '' }, 'caption')).not.toBe(
      mediaSourceHash({ id: 1, caption: null }, 'caption')
    );
    expect(mediaSourceHash(asset, 'caption', 'Context')).not.toBe(
      mediaSourceHash(asset, 'caption')
    );
  });
  it('protects metadata when the target uses a different asset even with force', () => {
    const prepared = prepare(
      prepareInput(
        { photo: { id: 1, alternativeText: 'Source' } },
        { target: { photo: { id: 2, alternativeText: 'Human' } }, mediaMetadata: true, force: true }
      )
    );
    expect(prepared.segments).toEqual([]);
    expect(prepared.protectedPaths).toEqual(['["photo"]']);
  });
  it('handles repeated media occurrences separately without media payloads in patches', () => {
    const photo = { id: 1, alternativeText: 'Source', url: '/source.png' };
    const prepared = prepare(prepareInput({ photo: [photo, photo] }, { mediaMetadata: true }));
    const result = apply(prepared, identity(prepared.segments));
    expect(result.media.map((entry) => entry.path)).toEqual([
      ['photo', 0],
      ['photo', 1],
    ]);
    expect(result.patch).toEqual({});
  });
  it('protects a human metadata edit that restores the original source text', () => {
    const source = { photo: { id: 1, caption: 'Source' } };
    const first = prepare(prepareInput(source, { mediaMetadata: true }));
    const result = apply(
      first,
      Object.fromEntries(first.segments.map((entry) => [entry.id, 'Machine']))
    );
    const prepared = prepare(
      prepareInput(source, { target: source, checkpoints: result.checkpoints, mediaMetadata: true })
    );
    expect(prepared.protectedPaths).toEqual(['["photo","caption"]']);
  });
  it('regenerates a UID when its title changes even if the source UID did not', () => {
    const rules = { slug: { translate: true, uidStrategy: 'regenerate' as const } };
    const first = prepare(prepareInput({ title: 'First', slug: 'same' }, { rules }));
    const previous = apply(first, identity(first.segments));
    const second = prepare(
      prepareInput(
        { title: 'Second', slug: 'same' },
        { target: previous.patch, checkpoints: previous.checkpoints, rules }
      )
    );
    expect(apply(second, identity(second.segments)).patch.slug).toBe('second');
  });
  it('copies configured UIDs and transliterates regenerated Unicode text', () => {
    const copy = prepare(
      prepareInput(
        { slug: 'copy-me' },
        { rules: { slug: { translate: true, uidStrategy: 'copy' } } }
      )
    );
    expect(apply(copy, {}).patch.slug).toBe('copy-me');
    const regenerate = prepare(
      prepareInput(
        { title: 'مرحبا بك', slug: 'source' },
        { rules: { slug: { translate: true, uidStrategy: 'regenerate' } } }
      )
    );
    expect(apply(regenerate, identity(regenerate.segments)).patch.slug).toBe('mrhba-bk');
  });
  it('rejects UID regeneration without a translated title or with whitespace-only output', () => {
    const rules = { slug: { translate: true, uidStrategy: 'regenerate' as const } };
    expect(() => apply(prepare(prepareInput({ slug: 'source' }, { rules })), {})).toThrow();
    const prepared = prepare(prepareInput({ title: 'Title', slug: 'source' }, { rules }));
    expect(() =>
      apply(prepared, Object.fromEntries(prepared.segments.map((entry) => [entry.id, '   '])))
    ).toThrow();
  });
  it('keeps unrelated checkpoints and rejects nonfinite numeric hashes', () => {
    const checkpoint = { sourceHash: 's', targetHash: 't' };
    const prepared = prepare(prepareInput({}, { checkpoints: { other: checkpoint } }));
    expect(apply(prepared, {}).checkpoints.other).toEqual(checkpoint);
    expect(() => hashValue(Number.NaN)).toThrow();
    expect(hashValue(null)).not.toBe(hashValue('null'));
    const values: JsonValue[] = [null, false, true, 0, '', [], {}];
    expect(new Set(values.map(hashValue)).size).toBe(values.length);
  });
  it('validates locale variants, explicit invalid mappings and retry input boundaries', () => {
    for (const locale of ['ar', 'he', 'zh-Hant', 'sr-Cyrl'])
      expect(resolveGtLocale(locale, {})).toBeTruthy();
    expect(() => resolveGtLocale('en', { en: '' })).toThrow();
    expect(() => resolveGtLocale('en', { en: 'qbr' })).toThrow();
    expect(() => resolveGtLocale('x-private', {})).toThrow();
    for (const attempt of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])
      expect(() => retryDelay(attempt)).toThrow();
    for (const random of [-0.1, 1.1, Number.NaN])
      expect(() => retryDelay(0, () => random)).toThrow();
    expect(retryDelay(1, () => 0.5)).toBeGreaterThan(0);
  });
});

describe('component references and incomplete populated values', () => {
  it('copies only reference identities for nested media and relations', () => {
    const components = {
      'content.card': {
        uid: 'content.card',
        localized: false,
        draftAndPublish: false,
        attributes: {
          heading: { type: 'string' as const },
          photo: { type: 'media' as const },
          gallery: { type: 'media' as const },
          related: { type: 'relation' as const },
          links: { type: 'relation' as const },
          secret: { type: 'string' as const, private: true },
        },
      },
    };
    const source = {
      card: {
        id: 3,
        heading: 'Hello',
        photo: { id: 8, url: '/source.png' },
        gallery: [{ id: 9 }, 10, null, {}],
        related: { documentId: 'doc' },
        links: [{ id: 7 }, 'other', {}],
        secret: 'Private',
      },
    };
    const prepared = prepare(prepareInput(source, { components }));
    expect(prepared.segments.map((entry) => entry.text)).toEqual(['Hello']);
    expect(apply(prepared, identity(prepared.segments)).patch.card).toEqual({
      heading: 'Hello',
      photo: 8,
      gallery: [9, 10, null, null],
      related: 'doc',
      links: [7, 'other', null],
    });
  });
  it('retains unpopulated media identities while translating a sibling', () => {
    const prepared = prepare(prepareInput({ card: { heading: 'Hello', photo: 4 } }));
    expect(apply(prepared, identity(prepared.segments)).patch.card).toEqual({
      heading: 'Hello',
      photo: 4,
    });
  });
  it('ignores unknown zone discriminators, invalid members and nontext Blocks leaves', () => {
    const prepared = prepare(
      prepareInput({
        sections: [null, { __component: 'missing.card', heading: 'No' }, { heading: 'No' }],
        blocks: [null, 5, { type: 'text', text: '' }, { type: 'unknown', children: null }],
      })
    );
    expect(prepared.segments).toEqual([]);
    expect(apply(prepared, {}).patch.blocks).toEqual([
      null,
      5,
      { type: 'text', text: '' },
      { type: 'unknown', children: null },
    ]);
  });
  it('ignores media without identities and allows raw shared metadata with no overlay history', () => {
    const photo = [{ id: 'asset', caption: 'Shared' }, { caption: 'No identity' }, 5, null];
    const prepared = prepare(prepareInput({ photo }, { target: { photo }, mediaMetadata: true }));
    expect(prepared.segments.map((entry) => entry.text)).toEqual(['Shared']);
    expect(apply(prepared, identity(prepared.segments)).media[0]?.assetId).toBe('asset');
    expect(mediaSourceHash({}, 'caption')).toMatch(/^[a-f0-9]+$/);
  });
  it('protects a nonempty localized media value with no overlay checkpoint', () => {
    const prepared = prepare(
      prepareInput(
        { photo: { id: 1, caption: 'Source' } },
        { target: { photo: { id: 1, caption: 'Human' } }, mediaMetadata: true }
      )
    );
    expect(prepared.protectedPaths).toEqual(['["photo","caption"]']);
  });
});

describe('database serialization order', () => {
  it('accepts a saved plan after JSONB reorders schema and document object keys', () => {
    const prepared = prepare(
      prepareInput({
        title: 'Hello',
        body: '# Heading',
        card: { heading: 'Card', cards: [{ heading: 'Nested' }], count: 4 },
      })
    );
    const reordered = structuredClone(prepared);
    reordered.input.schema.attributes = Object.fromEntries(
      Object.entries(reordered.input.schema.attributes).sort(([left], [right]) =>
        right.localeCompare(left)
      )
    );
    reordered.input.components = Object.fromEntries(
      Object.entries(reordered.input.components).map(([name, schema]) => [
        name,
        { ...schema, attributes: Object.fromEntries(Object.entries(schema.attributes).reverse()) },
      ])
    );
    reordered.input.source = Object.fromEntries(Object.entries(reordered.input.source).reverse());
    expect(apply(reordered, identity(prepared.segments))).toEqual(
      apply(prepared, identity(prepared.segments))
    );
  });
});
