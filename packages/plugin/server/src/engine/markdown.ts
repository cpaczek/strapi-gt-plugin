import { fromMarkdown } from 'mdast-util-from-markdown';
import { invalidTranslation } from './errors';

interface MarkdownNode {
  type: string;
  position?: { start: { offset?: number }; end: { offset?: number } };
  children?: readonly MarkdownNode[];
}
export interface MarkdownSpan {
  start: number;
  end: number;
  text: string;
}

export const markdownSpans = (source: string): MarkdownSpan[] => {
  const spans: MarkdownSpan[] = [];
  const visit = (node: MarkdownNode): void => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) return;
    if (node.type === 'link' && source[start] === '<') return;
    if (node.type === 'text') {
      const raw = source.slice(start, end);
      // Keep raw escapes, entities and line boundaries out of translated spans.
      const protectedSyntax =
        /\\[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]|&(?:#[0-9]+|#x[0-9a-f]+|[a-z][a-z0-9]+);|\r\n|\r|\n/gi;
      const add = (begin: number, finish: number): void => {
        const chunk = raw.slice(begin, finish);
        const trimmed = chunk.trim();
        if (!trimmed) return;
        const left = chunk.length - chunk.trimStart().length;
        spans.push({
          start: start + begin + left,
          end: start + begin + left + trimmed.length,
          text: trimmed,
        });
      };
      let cursor = 0;
      for (const match of raw.matchAll(protectedSyntax)) {
        add(cursor, match.index);
        cursor = match.index + match[0].length;
      }
      add(cursor, raw.length);
      return;
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(fromMarkdown(source));
  return spans;
};

export const replaceMarkdown = (
  source: string,
  spans: MarkdownSpan[],
  replacements: string[]
): string => {
  let result = source;
  for (let index = spans.length - 1; index >= 0; index -= 1) {
    const span = spans[index];
    const replacement = replacements[index];
    if (!span || replacement === undefined)
      throw invalidTranslation('A Markdown translation is missing');
    if (/[\r\n]/.test(replacement))
      throw invalidTranslation('A Markdown text translation added a line break');
    const safe =
      replacement === span.text
        ? replacement
        : replacement.replace(/([\\`*_[\]{}()<>#+.!|~&-])/g, '\\$1');
    result = result.slice(0, span.start) + safe + result.slice(span.end);
  }
  return result;
};
