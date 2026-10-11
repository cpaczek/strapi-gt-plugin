import { glob, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sizeLimit from 'size-limit';
import filePlugin from '@size-limit/file';

/** @param {string[]} files @param {number} limitBytes */
export const measureBundle = async (files, limitBytes) => {
  if (!Array.isArray(files) || files.length === 0)
    throw new Error('Build the admin bundle before checking its size.');
  if (!Number.isFinite(limitBytes) || limitBytes <= 0)
    throw new TypeError('The bundle budget must be a positive byte count.');
  /** @type {import('size-limit').PluginCheck} */
  const check = { files, sizeLimit: limitBytes, brotli: false };
  await sizeLimit([filePlugin], { checks: [check] });
  return { bytes: check.size, limitBytes, passed: check.passed === true };
};

const run = async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  /** @type {unknown} */
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  /** @type {unknown} */
  const budget =
    typeof manifest === 'object' &&
    manifest !== null &&
    'size-limit' in manifest &&
    Array.isArray(manifest['size-limit'])
      ? manifest['size-limit'][0]
      : undefined;
  if (
    typeof budget !== 'object' ||
    budget === null ||
    !('path' in budget) ||
    typeof budget.path !== 'string' ||
    !('limit' in budget) ||
    typeof budget.limit !== 'string'
  )
    throw new TypeError('Declare the admin size budget in package.json.');
  const match = /^(\d+(?:\.\d+)?) (B|kB|MB)$/.exec(budget.limit);
  if (!match) throw new TypeError('Use B, kB or MB in the admin size budget.');
  const factors = new Map([
    ['B', 1],
    ['kB', 1000],
    ['MB', 1000000],
  ]);
  const factor = factors.get(match[2] ?? '');
  if (factor === undefined) throw new TypeError('Use B, kB or MB in the admin size budget.');
  const files = [];
  for await (const path of glob(budget.path, { cwd: root })) files.push(resolve(root, path));
  const result = await measureBundle(files, Number(match[1]) * factor);
  process.stdout.write(
    `Admin bundle: ${result.bytes} bytes of ${result.limitBytes} bytes (uncompressed).\n`
  );
  if (!result.passed) process.exitCode = 1;
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await run();
