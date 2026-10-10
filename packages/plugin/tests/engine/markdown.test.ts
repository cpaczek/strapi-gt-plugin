import { describe, expect, it } from 'vitest';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';
import { translationEngine } from '../../server/src/engine';
import { identity, prepareInput } from './fixtures';

const parse = (text: string) =>
  fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
const { prepare, apply } = translationEngine;

describe('Markdown syntax boundaries', () => {
  it('keeps GFM tables, alignment, task lists, footnotes and strikethrough byte-identical', () => {
    const body =
      '| Name | Value |\r\n| :--- | ---: |\r\n| ~~Old~~ | New \\| value |\r\n\r\n- [x] Done\r\n- [ ] Pending\r\n\r\nA note[^id]\r\n\r\n[^id]: Footnote\r\n';
    const prepared = prepare(prepareInput({ body }));
    expect(prepared.segments.map((entry) => entry.text)).toEqual([
      'Name',
      'Value',
      'Old',
      'New',
      'value',
      'Done',
      'Pending',
      'A note',
      'Footnote',
    ]);
    expect(apply(prepared, identity(prepared.segments)).patch.body).toBe(body);
  });
  it('keeps translated GFM table dimensions and strikethrough structure', () => {
    const body = '| Name | Value |\n| :--- | ---: |\n| ~~Old~~ | New |\n';
    const prepared = prepare(prepareInput({ body }));
    const result = apply(
      prepared,
      Object.fromEntries(
        prepared.segments.map((entry) => [entry.id, `${entry.text} | ~~injected~~`])
      )
    ).patch.body;
    if (typeof result !== 'string') throw new Error('Expected Markdown output');
    const table = parse(result).children[0];
    if (table?.type !== 'table') throw new Error('Expected original table');
    expect(table.align).toEqual(['left', 'right']);
    expect(table.children.map((row) => row.children.length)).toEqual([2, 2]);
    expect(table.children[1]?.children[0]?.children[0]?.type).toBe('delete');
    expect(table.children[1]?.children[0]?.children).toHaveLength(1);
  });
  it('keeps bare URL and email autolinks out of translated text', () => {
    const body = 'Visit https://example.com or www.example.com and write editor@example.com.';
    const prepared = prepare(prepareInput({ body }));
    expect(prepared.segments.map((entry) => entry.text)).toEqual(['Visit', 'or', 'and write', '.']);
    expect(apply(prepared, identity(prepared.segments)).patch.body).toBe(body);
  });
  it('does not permit provider text to create new autolinks or indented code', () => {
    const prepared = prepare(prepareInput({ body: 'Hello' }));
    const result = apply(
      prepared,
      Object.fromEntries(
        prepared.segments.map((entry) => [
          entry.id,
          '    https://bad.example.com editor@example.com  ',
        ])
      )
    ).patch.body;
    if (typeof result !== 'string') throw new Error('Expected Markdown output');
    const paragraph = parse(result).children[0];
    if (paragraph?.type !== 'paragraph') throw new Error('Expected original paragraph');
    expect(paragraph.children.map((entry) => entry.type)).toEqual(['text']);
  });
  it('rejects empty translations that would collapse inline formatting into block syntax', () => {
    const prepared = prepare(prepareInput({ body: '**Hello**' }));
    expect(() =>
      apply(prepared, Object.fromEntries(prepared.segments.map((entry) => [entry.id, ' '])))
    ).toThrow();
  });
});
