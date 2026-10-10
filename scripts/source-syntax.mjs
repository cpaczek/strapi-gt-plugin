import { parseSync } from 'oxc-parser';

export const parseSyntax = (source, filename) => {
  const parsed = parseSync(filename, source);
  if (parsed.errors.length)
    throw new SyntaxError(`Cannot inspect ${filename}: ${parsed.errors[0].message}`);
  return parsed;
};

export const walkSyntax = (node, visit, parent) => {
  if (!node || typeof node !== 'object') return;
  if (typeof node.type === 'string') visit(node, parent);
  for (const child of Object.values(node)) {
    if (Array.isArray(child)) child.forEach((entry) => walkSyntax(entry, visit, node));
    else if (child && typeof child === 'object') walkSyntax(child, visit, node);
  }
};

export const literalValue = (node) => {
  if (node?.type === 'Literal' && ['string', 'number'].includes(typeof node.value))
    return node.value;
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0)
    return node.quasis[0]?.value.cooked;
  return undefined;
};
