import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const readmePath = resolve(root, 'README.md');
const readme = () => readFileSync(readmePath, 'utf8');

describe('published documentation contract', () => {
  it('keeps the required sixteen sections in reader order', () => {
    expect([...readme().matchAll(/^## (.+)$/gm)].map((match) => match[1])).toEqual([
      'What it does',
      'Screenshots',
      'Compatibility',
      'Install',
      'Configuration',
      'Usage',
      'Field handling',
      'Permissions',
      'GT usage and billing',
      'Strapi AI Translations',
      'Set up with a coding agent',
      'Known limitations',
      'Troubleshooting',
      'Security',
      'Contributing',
      'License and affiliation',
    ]);
  });
  it('includes one or two local PNG screenshots', () => {
    const section = readme().split('## Screenshots\n')[1]?.split('\n## ')[0] ?? '';
    const captures = [...section.matchAll(/!\[[^\]]+\]\(([^)]+)\)/g)];
    expect(captures.length).toBeGreaterThanOrEqual(1);
    expect(captures.length).toBeLessThanOrEqual(2);
    for (const capture of captures) {
      const imagePath = resolve(root, capture[1]);
      expect(imagePath.startsWith(`${root}/docs/screenshots/`)).toBe(true);
      expect([...readFileSync(imagePath).subarray(0, 8)]).toEqual([
        137, 80, 78, 71, 13, 10, 26, 10,
      ]);
    }
  });
  it('resolves every local link in the root README and contributor guide', () => {
    for (const filename of ['README.md', 'CONTRIBUTING.md']) {
      const pathname = resolve(root, filename);
      const markdown = readFileSync(pathname, 'utf8');
      for (const link of markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
        if (/^[a-z]+:/i.test(link[1]) || link[1].startsWith('#')) continue;
        expect(existsSync(resolve(dirname(pathname), link[1].split('#')[0])), link[1]).toBe(true);
      }
    }
  });
  it('extracts the real README shell blocks and runs its version probes', () => {
    const output = execFileSync(
      process.execPath,
      [resolve(root, 'scripts/check-readme.mjs'), readmePath, '--run-versions'],
      { cwd: root, encoding: 'utf8' }
    );
    const result = JSON.parse(output);
    expect(result.commands.map((entry: { command: string }) => entry.command)).toEqual([
      'node --version',
      'pnpm --version',
      'pnpm install --frozen-lockfile',
      'pnpm --filter strapi-plugin-general-translation build',
      'pnpm --filter strapi-plugin-general-translation verify',
      'pnpm --filter strapi-plugin-general-translation pack --pack-destination .work/packages',
      'pnpm add ./strapi-plugin-general-translation.tgz',
      'pnpm build',
      'pnpm start',
    ]);
    expect(result.executedVersionChecks).toHaveLength(2);
  });
  it('ships the same license in the plugin archive source', () => {
    expect(readFileSync(resolve(root, 'packages/plugin/LICENSE'), 'utf8')).toBe(
      readFileSync(resolve(root, 'LICENSE'), 'utf8')
    );
  });
  it('keeps the package README self-contained without missing relative links', () => {
    const packageRoot = resolve(root, 'packages/plugin');
    const markdown = readFileSync(resolve(packageRoot, 'README.md'), 'utf8');
    for (const link of markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      if (/^[a-z]+:/i.test(link[1])) continue;
      const pathname = resolve(packageRoot, link[1].split('#')[0]);
      expect(pathname.startsWith(`${packageRoot}/`)).toBe(true);
      expect(existsSync(pathname)).toBe(true);
    }
  });
});
