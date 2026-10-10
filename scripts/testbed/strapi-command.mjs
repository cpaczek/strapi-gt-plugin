import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(resolve(process.cwd(), 'package.json'));
const manifestPath = require.resolve('@strapi/strapi/package.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (typeof manifest.bin?.strapi !== 'string')
  throw new TypeError('Strapi CLI is not declared by the installed package');
const child = spawn(
  process.execPath,
  [resolve(dirname(manifestPath), manifest.bin.strapi), ...process.argv.slice(2)],
  {
    cwd: process.cwd(),
    env: { ...process.env, NODE_PATH: resolve(process.cwd(), 'node_modules') },
    stdio: 'inherit',
  }
);
process.once('SIGINT', () => child.kill('SIGINT'));
process.once('SIGTERM', () => child.kill('SIGTERM'));
const [code] = await once(child, 'exit');
process.exitCode = typeof code === 'number' ? code : 1;
