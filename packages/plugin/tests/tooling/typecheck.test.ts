import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const root = resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
const compilerManifestPath = require.resolve('typescript/package.json');
const compilerManifest = z
  .object({ bin: z.object({ tsc: z.string() }) })
  .parse(JSON.parse(readFileSync(compilerManifestPath, 'utf8')));
const compiler = resolve(dirname(compilerManifestPath), compilerManifest.bin.tsc);
const manifest = z
  .object({ scripts: z.object({ typecheck: z.string() }) })
  .parse(JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')));
const configurationSchema = z.object({
  compilerOptions: z.record(z.string(), z.unknown()),
  files: z.array(z.string()),
});
const runCompiler = (arguments_: string[]) =>
  spawnSync(process.execPath, [compiler, ...arguments_], { cwd: root, encoding: 'utf8' });
const configurations = () =>
  [...manifest.scripts.typecheck.matchAll(/\btsc\s+-p\s+([^\s&]+)/g)].map((match) => {
    const path = match[1];
    if (!path) throw new Error('Expected a typecheck project path');
    const shown = runCompiler(['-p', path, '--showConfig']);
    expect(shown.status, shown.stderr).toBe(0);
    return { path, ...configurationSchema.parse(JSON.parse(shown.stdout)) };
  });

describe('plugin test compiler coverage', () => {
  it('includes every TypeScript test and fixture in the package typecheck command', () => {
    const included = new Set(
      configurations().flatMap((config) =>
        config.files.map((path) => resolve(root, dirname(config.path), path))
      )
    );
    const tests = readdirSync(resolve(root, 'tests'), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
      .map((entry) => resolve(entry.parentPath, entry.name));
    expect(tests.length).toBeGreaterThan(0);
    expect(tests.filter((path) => !included.has(path))).toEqual([]);
  });

  it('retains strict checking for every configured project', () => {
    expect(configurations().length).toBeGreaterThan(0);
    for (const { compilerOptions } of configurations()) {
      expect(compilerOptions.noImplicitAny ?? compilerOptions.strict).toBe(true);
      expect(compilerOptions.strictNullChecks ?? compilerOptions.strict).toBe(true);
      expect(compilerOptions).toMatchObject({
        strict: true,
        noUncheckedIndexedAccess: true,
        noImplicitOverride: true,
        noUnusedLocals: true,
        noUnusedParameters: true,
        noEmit: true,
      });
    }
  });

  it('rejects invalid segment kinds and nullable mocks while accepting their valid controls', () => {
    const config =
      configurations().find((candidate) =>
        candidate.files.some(
          (path) =>
            resolve(root, dirname(candidate.path), path) ===
            resolve(import.meta.dirname, 'typecheck.test.ts')
        )
      ) ?? configurations()[0];
    if (!config) throw new Error('Expected compiler options from the package typecheck command');
    const evidenceRoot = resolve(root, '../../.work/typecheck');
    mkdirSync(evidenceRoot, { recursive: true });
    const directory = mkdtempSync(resolve(evidenceRoot, 'compiler-probe-'));
    try {
      writeFileSync(
        resolve(directory, 'probe.ts'),
        [
          `import type { TranslationSegment } from ${JSON.stringify(resolve(root, 'shared/contracts'))};`,
          "export const valid: TranslationSegment = { id: 'one', path: [], text: 'Hello', kind: 'text' };",
          "export const invalid: TranslationSegment = { ...valid, kind: 'string' };",
          'export const nullable: () => Promise<number | null> = async () => null;',
          'export const invalidNull: () => Promise<number> = async () => null;',
        ].join('\n')
      );
      writeFileSync(
        resolve(directory, 'tsconfig.json'),
        JSON.stringify({
          extends: resolve(root, config.path),
          compilerOptions: { rootDir: resolve(root, '../..') },
          files: ['./probe.ts'],
          include: [],
        })
      );
      const result = runCompiler(['-p', resolve(directory, 'tsconfig.json'), '--pretty', 'false']);
      expect(result.status).toBe(1);
      const diagnostics = result.stdout.split('\n').filter((line) => line.includes('error TS'));
      expect(diagnostics).toHaveLength(2);
      expect(diagnostics[0]).toMatch(/probe\.ts\(3,\d+\): error TS2322/);
      expect(diagnostics[1]).toMatch(/probe\.ts\(5,\d+\): error TS2322/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
