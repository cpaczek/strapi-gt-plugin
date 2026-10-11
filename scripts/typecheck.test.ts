import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const parseFile = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
const compilerManifestPath = require.resolve('typescript/package.json');
const compilerManifest = parseFile(compilerManifestPath);
if (
  !record(compilerManifest) ||
  !record(compilerManifest.bin) ||
  typeof compilerManifest.bin.tsc !== 'string'
)
  throw new Error('Expected the public TypeScript CLI in its package manifest');
const compiler = resolve(dirname(compilerManifestPath), compilerManifest.bin.tsc);
const authoredFiles = () =>
  execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean);
const configurations = () => {
  const configured: { manifestPath: string; files: string[]; options: Record<string, unknown> }[] =
    [];
  for (const manifestPath of authoredFiles().filter((path) => /(^|\/)package\.json$/.test(path))) {
    const manifest = parseFile(resolve(root, manifestPath));
    if (
      !record(manifest) ||
      !record(manifest.scripts) ||
      typeof manifest.scripts.typecheck !== 'string'
    )
      continue;
    const directory = dirname(resolve(root, manifestPath));
    for (const command of manifest.scripts.typecheck.split('&&').map((entry) => entry.trim())) {
      if (!/^tsc(?:\s|$)/.test(command)) continue;
      const project = /(?:^|\s)-p\s+([^\s]+)/.exec(command)?.[1] ?? 'tsconfig.json';
      const output: unknown = JSON.parse(
        execFileSync(process.execPath, [compiler, '-p', project, '--showConfig'], {
          cwd: directory,
          encoding: 'utf8',
        })
      );
      if (
        !record(output) ||
        !record(output.compilerOptions) ||
        !Array.isArray(output.files) ||
        !output.files.every((file: unknown): file is string => typeof file === 'string')
      )
        throw new Error(`Invalid compiler configuration for ${manifestPath}`);
      configured.push({
        manifestPath,
        files: output.files.map((path) => resolve(directory, dirname(project), path)),
        options: output.compilerOptions,
      });
    }
  }
  return configured;
};

describe('workspace compiler coverage', () => {
  it('includes every authored TypeScript source, test, fixture and configuration', () => {
    const included = new Set(configurations().flatMap((configuration) => configuration.files));
    const authored = authoredFiles().filter((path) => /\.[cm]?tsx?$/.test(path));
    expect(authored.length).toBeGreaterThan(0);
    expect(authored.filter((path) => !included.has(resolve(root, path)))).toEqual([]);
  });
  it('checks every workspace project in strict mode', () => {
    const configured = configurations();
    expect(configured.length).toBeGreaterThan(0);
    for (const { manifestPath, options } of configured) {
      expect(options.strict, manifestPath).toBe(true);
      expect(options.noImplicitAny ?? options.strict, manifestPath).toBe(true);
      expect(options.strictNullChecks ?? options.strict, manifestPath).toBe(true);
    }
  });
});
