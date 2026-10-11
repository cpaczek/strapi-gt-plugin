import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { runSafeCommand } from '../../../../scripts/testbed/safe-command.mjs';

it.each([false, true])(
  'destroys a partially loaded packed Strapi instance when destroy also fails=%s',
  async (closeFails) => {
    const directory = await mkdtemp(resolve(tmpdir(), 'gt-smoke-startup-'));
    try {
      const strapi = resolve(directory, 'node_modules/@strapi/strapi');
      const plugin = resolve(directory, 'node_modules/strapi-plugin-general-translation');
      await mkdir(strapi, { recursive: true });
      await mkdir(plugin, { recursive: true });
      await writeFile(
        resolve(strapi, 'package.json'),
        JSON.stringify({ name: '@strapi/strapi', main: './index.cjs' })
      );
      await writeFile(
        resolve(strapi, 'index.cjs'),
        `const { writeFileSync } = require('node:fs');
exports.compileStrapi = async () => ({});
exports.createStrapi = () => ({ load: async () => { throw new Error('Injected packed load failure'); }, destroy: async () => { writeFileSync('destroyed.txt', 'destroyed'); ${closeFails ? "throw new Error('Injected packed destroy failure');" : ''} } });
`
      );
      await writeFile(
        resolve(plugin, 'package.json'),
        JSON.stringify({
          name: 'strapi-plugin-general-translation',
          exports: { './strapi-server': './server.cjs' },
        })
      );
      await writeFile(resolve(plugin, 'server.cjs'), 'module.exports = {};');
      for (const script of [
        'fresh-smoke.mjs',
        'safe-command.mjs',
        'owned-process.mjs',
        'cleanup-resources.mjs',
      ])
        await cp(
          resolve(import.meta.dirname, '../../../../scripts/testbed', script),
          resolve(directory, script)
        );
      const failure = await runSafeCommand(process.execPath, ['fresh-smoke.mjs'], {
        cwd: directory,
        timeout: 5000,
      }).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(Error);
      if (!(failure instanceof Error)) throw new Error('The startup fixture did not fail');
      expect(failure.message).toContain('Injected packed load failure');
      expect(await readFile(resolve(directory, 'destroyed.txt'), 'utf8')).toBe('destroyed');
      if (closeFails) expect(failure.message).toContain('Injected packed destroy failure');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
);
