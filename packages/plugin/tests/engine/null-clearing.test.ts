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
