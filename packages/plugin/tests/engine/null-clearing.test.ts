import { describe, expect, it } from 'vitest';
import { hashValue, translationEngine } from '../../server/src/engine';
import type { JsonValue } from '../../shared/contracts';
import { identity, prepareInput } from './fixtures';

const { prepare, apply } = translationEngine;
const machine = (field: string, value: JsonValue) => {
  const prepared = prepare(prepareInput({ [field]: value }));
  return apply(prepared, identity(prepared.segments));
};

describe('explicit null clearing', () => {
  it.each([
    ['title', 'A title'],
    ['summary', 'An optional paragraph'],
    ['body', '# A heading\n\n**Text**'],
    [
      'blocks',
      [{ type: 'paragraph', children: [{ type: 'text', text: 'Block text', bold: true }] }],
    ],
  ] satisfies [string, JsonValue][])(
    'clears machine-owned %s locally and records the null checkpoint',
    (field, value) => {
      const previous = machine(field, value);
      const prepared = prepare(
        prepareInput(
          { [field]: null },
          { target: previous.patch, checkpoints: previous.checkpoints }
        )
      );
      expect(prepared.segments).toEqual([]);
      const cleared = apply(prepared, {});
      expect(cleared.patch).toEqual({ [field]: null });
      expect(cleared.checkpoints[JSON.stringify([field])]?.targetHash).toBe(hashValue(null));
      expect(cleared.checkpoints[JSON.stringify([field])]?.sourceHash).not.toBe(
        previous.checkpoints[JSON.stringify([field])]?.sourceHash
      );
    }
  );
  it('protects a human-edited target while recording the protected null intent', () => {
    const previous = machine('summary', 'Machine text');
    const prepared = prepare(
      prepareInput(
        { summary: null },
        { target: { summary: 'Human text' }, checkpoints: previous.checkpoints }
      )
    );
    expect(prepared.protectedPaths).toEqual(['["summary"]']);
    expect(prepared.segments).toEqual([]);
    expect(apply(prepared, {}).patch).toEqual({});
  });
  it('protects a preexisting target without machine history unless forced', () => {
    const input = prepareInput(
      { summary: null },
      { target: { summary: 'Preexisting human text' } }
    );
    expect(prepare(input).protectedPaths).toEqual(['["summary"]']);
    expect(apply(prepare(input), {}).patch).toEqual({});
    const forced = prepare({ ...input, force: true });
    expect(forced.segments).toEqual([]);
    expect(apply(forced, {}).patch).toEqual({ summary: null });
  });
  it('clears a nested string while preserving target component identity and nontext fields', () => {
    const first = prepare(prepareInput({ card: { heading: 'Machine heading', count: 7 } }));
    const previous = apply(first, identity(first.segments));
    const prepared = prepare(
      prepareInput(
        { card: { heading: null, count: 7 } },
        {
          checkpoints: previous.checkpoints,
          target: { card: { id: 91, heading: 'Machine heading', count: 999 } },
        }
      )
    );
    expect(prepared.segments).toEqual([]);
    expect(apply(prepared, {}).patch).toEqual({ card: { id: 91, heading: null, count: 999 } });
  });
  it('does not interpret an absent source attribute as a clear even with force', () => {
    const previous = machine('summary', 'Machine text');
    const prepared = prepare(
      prepareInput({}, { target: previous.patch, checkpoints: previous.checkpoints, force: true })
    );
    expect(prepared.segments).toEqual([]);
    expect(apply(prepared, {}).patch).toEqual({});
  });
  it('keeps initially null and missing target fields unchanged', () => {
    expect(
      apply(prepare(prepareInput({ summary: null, body: null, blocks: null })), {}).patch
    ).toEqual({});
  });
});

describe('null clearing boundaries', () => {
  it('treats an explicit undefined value as absent rather than null', () => {
    const previous = machine('summary', 'Machine');
    const source: Record<string, JsonValue> = {};
    Object.defineProperty(source, 'summary', { value: undefined, enumerable: true });
    const prepared = prepare(
      prepareInput(source, {
        target: previous.patch,
        checkpoints: previous.checkpoints,
        force: true,
      })
    );
    expect(apply(prepared, {}).patch).toEqual({});
  });
  it('recognizes a repeated null clear as unchanged', () => {
    const previous = machine('summary', 'Machine');
    const cleared = apply(
      prepare(
        prepareInput(
          { summary: null },
          { target: previous.patch, checkpoints: previous.checkpoints }
        )
      ),
      {}
    );
    const repeated = prepare(
      prepareInput({ summary: null }, { target: cleared.patch, checkpoints: cleared.checkpoints })
    );
    expect(repeated.unchangedPaths).toEqual(['["summary"]']);
    expect(apply(repeated, {}).patch).toEqual({});
    expect(apply(repeated, {}).checkpoints).toEqual(cleared.checkpoints);
  });
  it('translates restored text after a machine-owned null clear', () => {
    const previous = machine('summary', 'Machine');
    const cleared = apply(
      prepare(
        prepareInput(
          { summary: null },
          { target: previous.patch, checkpoints: previous.checkpoints }
        )
      ),
      {}
    );
    const restored = prepare(
      prepareInput(
        { summary: 'Restored' },
        { target: cleared.patch, checkpoints: cleared.checkpoints }
      )
    );
    expect(restored.segments.map((entry) => entry.text)).toEqual(['Restored']);
    expect(restored.protectedPaths).toEqual([]);
  });
  it('protects human text entered after a machine-owned null clear', () => {
    const previous = machine('summary', 'Machine');
    const cleared = apply(
      prepare(
        prepareInput(
          { summary: null },
          { target: previous.patch, checkpoints: previous.checkpoints }
        )
      ),
      {}
    );
    const edited = prepare(
      prepareInput(
        { summary: null },
        { target: { summary: 'New human text' }, checkpoints: cleared.checkpoints }
      )
    );
    expect(edited.protectedPaths).toEqual(['["summary"]']);
    expect(apply(edited, {}).patch).toEqual({});
  });
  it('clears only the changed field without resending unchanged siblings', () => {
    const initial = prepare(prepareInput({ title: 'Same title', summary: 'Remove me' }));
    const previous = apply(initial, identity(initial.segments));
    const prepared = prepare(
      prepareInput(
        { title: 'Same title', summary: null },
        { target: previous.patch, checkpoints: previous.checkpoints }
      )
    );
    expect(prepared.segments).toEqual([]);
    expect(apply(prepared, {}).patch).toEqual({ summary: null });
  });
  it('keeps disabled, private and nonlocalized null fields excluded', () => {
    const prepared = prepare(
      prepareInput(
        { summary: null, secret: null, shared: null },
        {
          target: { summary: 'Disabled', secret: 'Private', shared: 'Shared' },
          force: true,
          rules: { summary: { translate: false } },
        }
      )
    );
    expect(apply(prepared, {}).patch).toEqual({});
  });
  it('clears nested Markdown and Blocks without replacing their component sibling data', () => {
    const components = {
      'content.card': {
        uid: 'content.card',
        localized: false,
        draftAndPublish: false,
        attributes: {
          body: { type: 'richtext' as const },
          blocks: { type: 'blocks' as const },
          count: { type: 'integer' as const },
        },
      },
    };
    const first = prepare(
      prepareInput(
        {
          card: {
            body: '**Body**',
            blocks: [{ type: 'paragraph', children: [{ type: 'text', text: 'Text' }] }],
            count: 7,
          },
        },
        { components }
      )
    );
    const previous = apply(first, identity(first.segments));
    const prepared = prepare(
      prepareInput(
        { card: { body: null, blocks: null, count: 7 } },
        { components, target: previous.patch, checkpoints: previous.checkpoints }
      )
    );
    expect(prepared.segments).toEqual([]);
    expect(apply(prepared, {}).patch.card).toEqual({ body: null, blocks: null, count: 7 });
  });
  it('clears text in repeated components and dynamic zones without reordering them', () => {
    const original = {
      card: { cards: [{ heading: 'العربية' }, { heading: '👩🏽‍🚀 e\u0301' }] },
      sections: [{ __component: 'content.card', heading: 'שלום', count: 5 }],
    };
    const first = prepare(prepareInput(original));
    const previous = apply(first, identity(first.segments));
    const source = {
      card: { cards: [{ heading: null }, { heading: null }] },
      sections: [{ __component: 'content.card', heading: null, count: 5 }],
    };
    const prepared = prepare(
      prepareInput(source, { target: previous.patch, checkpoints: previous.checkpoints })
    );
    expect(prepared.segments).toEqual([]);
    expect(apply(prepared, {}).patch).toEqual(source);
  });
  it('protects human Blocks formatting changes unless force is explicit', () => {
    const original = [{ type: 'paragraph', children: [{ type: 'text', text: 'Text' }] }];
    const previous = machine('blocks', original);
    const input = prepareInput(
      { blocks: null },
      {
        target: {
          blocks: [{ type: 'paragraph', children: [{ type: 'text', text: 'Text', bold: true }] }],
        },
        checkpoints: previous.checkpoints,
      }
    );
    expect(prepare(input).protectedPaths).toEqual(['["blocks"]']);
    expect(apply(prepare(input), {}).patch).toEqual({});
    expect(apply(prepare({ ...input, force: true }), {}).patch).toEqual({ blocks: null });
  });
  it('does not turn null components, media, relations or nontext attributes into deletion patches', () => {
    const source = {
      card: null,
      sections: null,
      photo: null,
      related: null,
      count: null,
      slug: null,
    };
    const target = {
      card: { heading: 'Human' },
      sections: [{ __component: 'content.card', heading: 'Human' }],
      photo: { id: 1, caption: 'Photo' },
      related: { id: 2 },
      count: 7,
      slug: 'existing',
    };
    const prepared = prepare(
      prepareInput(source, {
        target,
        force: true,
        mediaMetadata: true,
        rules: { slug: { translate: true, uidStrategy: 'copy' } },
      })
    );
    expect(apply(prepared, {}).patch).toEqual({});
    expect(apply(prepared, {}).media).toEqual([]);
  });
  it('keeps null media metadata in raw assets without overwriting manual overlays', () => {
    const asset = { id: 1, alternativeText: null, caption: null };
    const prepared = prepare(
      prepareInput(
        { photo: asset },
        {
          target: { photo: { id: 1, alternativeText: 'Human alt', caption: 'Human caption' } },
          mediaMetadata: true,
        }
      )
    );
    expect(prepared.segments).toEqual([]);
    expect(apply(prepared, {}).media).toEqual([]);
    expect(asset).toEqual({ id: 1, alternativeText: null, caption: null });
  });
  it('rejects changed source and target snapshots even for local-only null clears', () => {
    const previous = machine('summary', 'Machine');
    const prepared = prepare(
      prepareInput({ summary: null }, { target: previous.patch, checkpoints: previous.checkpoints })
    );
    const changedSource = structuredClone(prepared);
    changedSource.input.source.summary = 'Changed';
    expect(() => apply(changedSource, {})).toThrow();
    const changedTarget = structuredClone(prepared);
    if (changedTarget.input.target) changedTarget.input.target.summary = 'Human';
    expect(() => apply(changedTarget, {})).toThrow();
  });
});

it('preserves a human-cleared empty string until null clearing is explicitly forced', () => {
  const previous = machine('summary', 'Machine');
  const input = prepareInput(
    { summary: null },
    { target: { summary: '' }, checkpoints: previous.checkpoints }
  );
  expect(prepare(input).protectedPaths).toEqual(['["summary"]']);
  expect(apply(prepare(input), {}).patch).toEqual({});
  expect(apply(prepare({ ...input, force: true }), {}).patch).toEqual({ summary: null });
});
