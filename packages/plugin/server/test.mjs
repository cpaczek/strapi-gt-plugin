import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { delimiter, dirname, resolve } from 'node:path';

const packageRoot = resolve(import.meta.dirname, '..');
const repositoryRoot = resolve(packageRoot, '../..');
const require = createRequire(resolve(packageRoot, 'package.json'));
const manifestPath = require.resolve('vitest/package.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (typeof manifest.bin?.vitest !== 'string')
  throw new TypeError('Vitest does not expose its public CLI');
const child = spawn(
  process.execPath,
  [resolve(dirname(manifestPath), manifest.bin.vitest), 'run', ...process.argv.slice(2)],
  {
    cwd: packageRoot,
    env: {
      ...process.env,
      NODE_PATH: [
        resolve(packageRoot, 'node_modules'),
        resolve(repositoryRoot, 'playground/node_modules'),
      ].join(delimiter),
    },
    stdio: 'inherit',
  }
);
process.once('SIGINT', () => child.kill('SIGINT'));
process.once('SIGTERM', () => child.kill('SIGTERM'));
const [code] = await once(child, 'exit');
process.exitCode = typeof code === 'number' ? code : 1;
