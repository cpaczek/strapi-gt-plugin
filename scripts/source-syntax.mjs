import { parseSync } from 'oxc-parser';

/** @param {unknown} value @returns {value is Record<string, unknown>} */
export const syntaxRecord = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** @param {string} source @param {string} filename */
export const parseSyntax = (source, filename) => {
  const parsed = parseSync(filename, source);
  const error = parsed.errors[0];
  if (error) throw new SyntaxError(`Cannot inspect ${filename}: ${error.message}`);
  return parsed;
};

/**
 * @param {unknown} node
 * @param {(node: Record<string, unknown>, parent?: Record<string, unknown>) => void} visit
 * @param {Record<string, unknown>} [parent]
 */
export const walkSyntax = (node, visit, parent) => {
  if (!syntaxRecord(node)) return;
  if (typeof node.type === 'string') visit(node, parent);
  for (const child of Object.values(node)) {
    if (Array.isArray(child)) child.forEach((entry) => walkSyntax(entry, visit, node));
    else if (child && typeof child === 'object') walkSyntax(child, visit, node);
  }
};

/** @param {unknown} node */
export const literalValue = (node) => {
  if (!syntaxRecord(node)) return undefined;
  if (node.type === 'Literal' && (typeof node.value === 'string' || typeof node.value === 'number'))
    return node.value;
  if (
    node.type === 'TemplateLiteral' &&
    Array.isArray(node.expressions) &&
    node.expressions.length === 0 &&
    Array.isArray(node.quasis)
  ) {
    const first = node.quasis[0];
    if (
      syntaxRecord(first) &&
      syntaxRecord(first.value) &&
      (typeof first.value.cooked === 'string' || first.value.cooked === null)
    )
      return first.value.cooked;
  }
  return undefined;
};
