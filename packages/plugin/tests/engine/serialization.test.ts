import { describe, expect, it } from 'vitest';
import { hashValue, translationEngine } from '../../server/src/engine';
import { identity, prepareInput } from './fixtures';

const { prepare, apply } = translationEngine;

describe('schema-aware translation', () => {
  it('sends localized public text and leaves unrelated values out of the patch', () => {
    const prepared = prepare(
      prepareInput({
        title: 'Hello',
        count: 42,
        secret: 'Private',
        shared: 'Shared',
        related: { id: 9, title: 'Related' },
      })
    );
    expect(prepared.segments.map((item) => item.text)).toEqual(['Hello']);
    expect(apply(prepared, identity(prepared.segments)).patch).toEqual({ title: 'Hello' });
  });
  it('keeps Markdown byte-identical through identity translation', () => {
    const body =
      '# Heading\r\n\r\nA **bold** &amp; \\*literal\\* [label](https://example.com/a?q=1 "title")\r\n\r\n> Quote  \r\n> next\r\n\r\n```js\r\nconst untouched = "code";\r\n```\r\n';
    const prepared = prepare(prepareInput({ body }));
    expect(prepared.segments.map((item) => item.text).join(' ')).not.toContain('const untouched');
    expect(apply(prepared, identity(prepared.segments)).patch.body).toBe(body);
  });
  it('translates Blocks text without altering marks, links, or nodes', () => {
    const blocks = [
      {
        type: 'paragraph',
        children: [
          { type: 'text', text: 'Hello', bold: true },
          { type: 'link', url: '/hello', children: [{ type: 'text', text: 'World' }] },
        ],
      },
    ];
    const prepared = prepare(prepareInput({ blocks }));
    expect(prepared.segments.map((item) => item.text)).toEqual(['Hello', 'World']);
    expect(
      apply(
        prepared,
        Object.fromEntries(prepared.segments.map((item) => [item.id, `${item.text}!`]))
      ).patch.blocks
    ).toEqual([
      {
        type: 'paragraph',
        children: [
          { type: 'text', text: 'Hello!', bold: true },
          { type: 'link', url: '/hello', children: [{ type: 'text', text: 'World!' }] },
        ],
      },
    ]);
  });
  it('walks recursive components and dynamic zones while stripping copied component IDs', () => {
    const prepared = prepare(
      prepareInput({
        card: { id: 1, heading: 'One', count: 7, cards: [{ id: 2, heading: 'Two', count: 8 }] },
        sections: [{ id: 3, __component: 'content.card', heading: 'Three', count: 9 }],
      })
    );
    expect(prepared.segments.map((item) => item.text)).toEqual(['One', 'Two', 'Three']);
    expect(apply(prepared, identity(prepared.segments)).patch).toEqual({
      card: { heading: 'One', count: 7, cards: [{ heading: 'Two', count: 8 }] },
      sections: [{ __component: 'content.card', heading: 'Three', count: 9 }],
    });
  });
  it('retains unselected target fields and existing target component IDs', () => {
    const prepared = prepare(
      prepareInput(
        { card: { id: 1, heading: 'New', count: 7 } },
        { target: { card: { id: 91, heading: '', count: 12 }, summary: 'Keep' } }
      )
    );
    expect(apply(prepared, identity(prepared.segments)).patch).toEqual({
      card: { id: 91, heading: 'New', count: 12 },
    });
  });
  it('does not overwrite an existing target without machine history', () => {
    const prepared = prepare(prepareInput({ title: 'Source' }, { target: { title: 'Human' } }));
    expect(prepared.segments).toEqual([]);
    expect(prepared.protectedPaths).toContain('["title"]');
    expect(apply(prepared, {}).patch).toEqual({});
  });
  it('skips unchanged source, detects target edits, and permits explicit force', () => {
    const first = prepare(prepareInput({ title: 'Source' }));
    const result = apply(
      first,
      Object.fromEntries(first.segments.map((item) => [item.id, 'Translated']))
    );
    const next = prepareInput(
      { title: 'Source' },
      { target: { title: 'Translated' }, checkpoints: result.checkpoints }
    );
    expect(prepare(next).unchangedPaths).toContain('["title"]');
    expect(
      prepare({ ...next, source: { title: 'Changed' }, target: { title: 'Human' } }).segments
    ).toEqual([]);
    expect(prepare({ ...next, force: true, target: { title: 'Human' } }).segments).toHaveLength(1);
  });
  it('sends changed context again and includes context on every segment', () => {
    const first = prepare(
      prepareInput({ title: 'Bank' }, { rules: { title: { translate: true, context: 'River' } } })
    );
    const applied = apply(first, identity(first.segments));
    const next = prepare(
      prepareInput(
        { title: 'Bank' },
        {
          target: { title: 'Bank' },
          checkpoints: applied.checkpoints,
          rules: { title: { translate: true, context: 'Finance' } },
        }
      )
    );
    expect(next.segments).toHaveLength(1);
    expect(next.segments[0]?.context).toBe('Finance');
  });
  it('returns opt-in media metadata separately and never patches upload records', () => {
    const photo = {
      id: 5,
      hash: 'asset-hash',
      url: '/image.png',
      alternativeText: 'Bird',
      caption: 'At dusk',
    };
    const prepared = prepare(prepareInput({ photo }, { mediaMetadata: true }));
    const applied = apply(prepared, identity(prepared.segments));
    expect(prepared.segments.map((item) => item.text)).toEqual(['Bird', 'At dusk']);
    expect(applied.patch).toEqual({});
    expect(applied.media).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ['photo'], assetId: '5', alternativeText: 'Bird' }),
        expect.objectContaining({ path: ['photo'], assetId: '5', caption: 'At dusk' }),
      ])
    );
    expect(photo.alternativeText).toBe('Bird');
  });
  it('rejects missing and unexpected translated segment identities', () => {
    const prepared = prepare(prepareInput({ title: 'Hello' }));
    expect(() => apply(prepared, {})).toThrow();
    expect(() => apply(prepared, { ...identity(prepared.segments), unknown: 'Bad' })).toThrow();
  });
  it('rejects source or target mutations after preparation even with force', () => {
    const prepared = prepare(prepareInput({ title: 'Hello' }, { force: true }));
    prepared.input.source.title = 'Changed';
    expect(() => apply(prepared, identity(prepared.segments))).toThrow();
  });
  it('copies or regenerates configured UIDs without sending slugs to GT', () => {
    const prepared = prepare(
      prepareInput(
        { title: 'A title', slug: 'source-slug' },
        { rules: { slug: { translate: true, uidStrategy: 'regenerate', sourceField: 'title' } } }
      )
    );
    expect(prepared.segments).toHaveLength(1);
    expect(
      apply(prepared, Object.fromEntries(prepared.segments.map((item) => [item.id, 'Un titre'])))
        .patch.slug
    ).toBe('un-titre');
  });
  it('hashes object keys canonically while retaining array order and value types', () => {
    expect(hashValue({ b: 2, a: 1 })).toBe(hashValue({ a: 1, b: 2 }));
    expect(hashValue([1, 2])).not.toBe(hashValue([2, 1]));
    expect(hashValue('1')).not.toBe(hashValue(1));
  });
});
