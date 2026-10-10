import type { ReactNode } from 'react';
import Image from 'next/image';
import { fromMarkdown } from 'mdast-util-from-markdown';
import type { BlockNode } from './content';

const safeHref = (href: string | undefined): string | undefined => {
  if (!href) return undefined;
  try {
    const url = new URL(href, 'https://example.invalid');
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? href : undefined;
  } catch {
    return undefined;
  }
};
const block = (node: BlockNode, key: string): ReactNode => {
  const children = node.children?.map((child, index) => block(child, `${key}-${index}`));
  if (node.type === 'text') {
    const value = node.code ? <code>{node.text}</code> : node.text;
    const weight = node.bold ? <strong>{value}</strong> : value;
    const style = node.italic ? <em>{weight}</em> : weight;
    const strike = node.strikethrough ? <s>{style}</s> : style;
    return (
      <span key={key} className={node.underline ? 'underlined' : undefined}>
        {strike}
      </span>
    );
  }
  if (node.type === 'paragraph') return <p key={key}>{children}</p>;
  if (node.type === 'heading') {
    if (node.level === 3) return <h3 key={key}>{children}</h3>;
    if (node.level === 4) return <h4 key={key}>{children}</h4>;
    return <h2 key={key}>{children}</h2>;
  }
  if (node.type === 'list')
    return node.format === 'ordered' ? (
      <ol key={key}>{children}</ol>
    ) : (
      <ul key={key}>{children}</ul>
    );
  if (node.type === 'list-item') return <li key={key}>{children}</li>;
  if (node.type === 'link')
    return (
      <a key={key} href={safeHref(node.url)}>
        {children}
      </a>
    );
  if (node.type === 'quote') return <blockquote key={key}>{children}</blockquote>;
  if (node.type === 'code')
    return (
      <pre key={key}>
        <code>{children}</code>
      </pre>
    );
  if (node.type === 'image' && node.image && safeHref(node.image.url))
    return (
      <Image
        key={key}
        src={node.image.url}
        width={960}
        height={600}
        alt={node.image.alternativeText ?? ''}
      />
    );
  return <span key={key}>{children}</span>;
};
export const Blocks = ({ nodes }: { nodes: BlockNode[] }) => (
  <>{nodes.map((node, index) => block(node, `block-${index}`))}</>
);
interface MarkdownNode {
  type: string;
  value?: string;
  depth?: number;
  url?: string;
  ordered?: boolean | null;
  children?: MarkdownNode[];
}
const markdown = (node: MarkdownNode, key: string): ReactNode => {
  const children = node.children?.map((child, index) => markdown(child, `${key}-${index}`));
  switch (node.type) {
    case 'text':
      return node.value;
    case 'paragraph':
      return <p key={key}>{children}</p>;
    case 'strong':
      return <strong key={key}>{children}</strong>;
    case 'emphasis':
      return <em key={key}>{children}</em>;
    case 'inlineCode':
      return <code key={key}>{node.value}</code>;
    case 'code':
      return (
        <pre key={key}>
          <code>{node.value}</code>
        </pre>
      );
    case 'heading':
      return node.depth === 3 ? <h3 key={key}>{children}</h3> : <h2 key={key}>{children}</h2>;
    case 'list':
      return node.ordered ? <ol key={key}>{children}</ol> : <ul key={key}>{children}</ul>;
    case 'listItem':
      return <li key={key}>{children}</li>;
    case 'link':
      return (
        <a key={key} href={safeHref(node.url)}>
          {children}
        </a>
      );
    case 'blockquote':
      return <blockquote key={key}>{children}</blockquote>;
    case 'thematicBreak':
      return <hr key={key} />;
    case 'break':
      return <br key={key} />;
    case 'html':
      return <span key={key}>{node.value}</span>;
    default:
      return <span key={key}>{children}</span>;
  }
};
export const Markdown = ({ source }: { source: string }) => (
  <>{fromMarkdown(source).children.map((node, index) => markdown(node, `markdown-${index}`))}</>
);
