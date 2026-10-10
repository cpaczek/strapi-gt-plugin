import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSyntax, walkSyntax, literalValue } from './source-syntax.mjs';

const constantsPath = 'packages/plugin/shared/constants.ts';
export const checkDefaultLiterals = (source, canonical, filename) => {
  const values = new Map(Object.entries(canonical).map(([name, value]) => [value, name]));
  const findings = [];
  walkSyntax(parseSyntax(source, filename).program, (node, parent) => {
    const value = literalValue(node);
    if (value !== undefined && values.has(value) && parent?.type !== 'TSLiteralType') {
      const line = source.slice(0, node.start).split('\n').length;
      findings.push(
        `${filename}:${line}: import ${values.get(value)} from shared/constants instead of repeating its value`
      );
    }
  });
  return findings;
};

const run = () => {
  const canonical = {};
  const source = parseSyntax(readFileSync(constantsPath, 'utf8'), constantsPath).program;
  for (const statement of source.body) {
    const declaration =
      statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement;
    if (declaration?.type !== 'VariableDeclaration') continue;
    for (const entry of declaration.declarations) {
      if (entry.id.type !== 'Identifier' || !entry.init) continue;
      const value = literalValue(entry.init);
      if (value !== undefined) canonical[entry.id.name] = value;
    }
  }
  const paths = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { encoding: 'utf8' }
  ).split('\0');
  const findings = [];
  for (const filename of new Set(paths)) {
    if (
      filename === constantsPath ||
      !filename.startsWith('packages/plugin/') ||
      !/\.[jt]sx?$/.test(filename) ||
      filename.includes('/tests/') ||
      filename.endsWith('.d.ts') ||
      !existsSync(filename)
    )
      continue;
    findings.push(...checkDefaultLiterals(readFileSync(filename, 'utf8'), canonical, filename));
  }
  if (findings.length) {
    process.stderr.write(`${findings.join('\n')}\n`);
    process.exitCode = 1;
  } else process.stdout.write('Canonical defaults check passed.\n');
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run();
