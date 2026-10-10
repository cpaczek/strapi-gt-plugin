import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { declaredBinary } from './package-bin.mjs';

const require = createRequire(resolve(process.cwd(), 'package.json'));
const manifestPath = require.resolve('next/package.json');
const binary = declaredBinary(JSON.parse(await readFile(manifestPath, 'utf8')), 'next');
const port = process.env.READER_PORT ?? '3000';
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)
  throw new TypeError('READER_PORT must be a valid TCP port');
const child = spawn(
  process.execPath,
  [
    resolve(dirname(manifestPath), binary),
    ...process.argv.slice(2),
    '--hostname',
    '127.0.0.1',
    '--port',
    port,
  ],
  { cwd: process.cwd(), env: process.env, stdio: 'inherit' }
);
process.once('SIGINT', () => child.kill('SIGINT'));
process.once('SIGTERM', () => child.kill('SIGTERM'));
const [code] = await once(child, 'exit');
process.exitCode = typeof code === 'number' ? code : 1;
