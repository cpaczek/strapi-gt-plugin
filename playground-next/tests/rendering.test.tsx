import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Blocks, Markdown } from '../lib/blocks';

describe('structured article rendering', () => {
  it('renders marks and links without interpreting text as HTML', () => {
    const html = renderToStaticMarkup(
      <Blocks
        nodes={[
          {
            type: 'paragraph',
            children: [{ type: 'text', text: '<script>unsafe</script>', bold: true }],
          },
        ]}
      />
    );
    expect(html).toContain('<strong>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });
  it('removes executable Blocks link targets', () => {
    const html = renderToStaticMarkup(
      <Blocks
        nodes={[
          { type: 'link', url: 'javascript:alert(1)', children: [{ type: 'text', text: 'Read' }] },
        ]}
      />
    );
    expect(html).not.toContain('href=');
  });
  it('renders Markdown syntax and keeps raw HTML inert', () => {
    const html = renderToStaticMarkup(
      <Markdown source={'## Field guide\n\n**Strong** and `code`\n\n<script>alert(1)</script>'} />
    );
    expect(html).toContain('<h2>Field guide</h2>');
    expect(html).toContain('<strong>Strong</strong>');
    expect(html).not.toContain('<script>');
  });
  it('keeps executable Markdown links inert', () => {
    expect(renderToStaticMarkup(<Markdown source="[Read](javascript:alert)" />)).not.toContain(
      'href='
    );
  });
});
