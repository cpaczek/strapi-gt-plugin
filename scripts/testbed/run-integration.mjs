import { declaredBinary } from './package-bin.mjs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const root = resolve(import.meta.dirname, '../..');
const require = createRequire(resolve(root, 'tests/apps/acceptance/package.json'));
const manifestPath = require.resolve('vitest/package.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const binary = declaredBinary(manifest, 'vitest');
const child = spawn(
  process.execPath,
  [resolve(dirname(manifestPath), binary), 'run', '--config', 'vitest.integration.config.ts'],
  {
    cwd: resolve(root, 'tests/apps/acceptance'),
    env: { ...process.env, NODE_PATH: resolve(root, 'playground/node_modules') },
    stdio: 'inherit',
  }
);
process.once('SIGINT', () => child.kill('SIGINT'));
process.once('SIGTERM', () => child.kill('SIGTERM'));
const [code] = await once(child, 'exit');
process.exitCode = typeof code === 'number' ? code : 1;
