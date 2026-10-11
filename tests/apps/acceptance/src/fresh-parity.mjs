import assert from 'node:assert/strict';
import { browserChildEnvironment } from './browser-fixture.ts';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, readFile, symlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { setTimeout as pollDelay } from 'node:timers/promises';
import {
  runSafeCommand,
  sanitizeCommandOutput,
} from '../../../../scripts/testbed/safe-command.mjs';
import { stopOwnedProcessGroup } from '../../../../scripts/testbed/owned-process.mjs';
import { declaredBinary } from '../../../../scripts/testbed/package-bin.mjs';

const root = resolve(import.meta.dirname, '../../../..');
const originArgument = process.argv[2];
assert.ok(originArgument, 'Packed app origin was not supplied');
const origin = new URL(originArgument);
assert.equal(origin.protocol, 'http:');
assert.equal(origin.hostname, '127.0.0.1');
assert.equal(origin.username, '');
assert.equal(origin.password, '');
const accountFile = process.argv[3];
assert.ok(accountFile, 'Packed browser account was not supplied');
const directory = await mkdtemp(resolve(root, 'tests/apps/.generated/packed-reader-'));
const readerDirectory = resolve(directory, 'playground-next');
await mkdir(readerDirectory);
await cp(resolve(root, 'tsconfig.base.json'), resolve(directory, 'tsconfig.base.json'));
const sharedDirectory = resolve(directory, 'packages/plugin/shared');
await mkdir(sharedDirectory, { recursive: true });
for (const name of ['messages.ts', 'constants.ts', 'contracts.ts'])
  await cp(resolve(root, 'packages/plugin/shared', name), resolve(sharedDirectory, name));
const translationDirectory = resolve(directory, 'packages/plugin/admin/src/translations');
await mkdir(translationDirectory, { recursive: true });
await cp(
  resolve(root, 'packages/plugin/admin/src/translations/en.json'),
  resolve(translationDirectory, 'en.json')
);
for (const path of ['app', 'lib', 'package.json', 'tsconfig.json', 'next.config.ts'])
  await cp(resolve(root, 'playground-next', path), resolve(readerDirectory, path), {
    recursive: true,
  });
await symlink(
  resolve(root, 'playground-next/node_modules'),
  resolve(readerDirectory, 'node_modules'),
  'dir'
);
const environment = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  LANG: process.env.LANG,
  NODE_ENV: 'production',
  NEXT_TELEMETRY_DISABLED: '1',
  STRAPI_URL: origin.origin,
};
const require = createRequire(resolve(root, 'playground-next/package.json'));
const manifestPath = require.resolve('next/package.json');
const binary = declaredBinary(JSON.parse(await readFile(manifestPath, 'utf8')), 'next');
const nextCli = resolve(dirname(manifestPath), binary);
const build = await runSafeCommand(process.execPath, [nextCli, 'build', '--webpack'], {
  cwd: readerDirectory,
  env: environment,
  timeout: 180000,
  maxBuffer: 2000000,
});
process.stdout.write(build.stdout);
process.stderr.write(build.stderr);
const reservation = createServer();
reservation.listen(0, '127.0.0.1');
await once(reservation, 'listening');
const address = reservation.address();
assert.ok(address && typeof address !== 'string');
const port = address.port;
await new Promise((resolve, reject) =>
  reservation.close((error) => (error ? reject(error) : resolve(undefined)))
);
const reader = spawn(
  process.execPath,
  [nextCli, 'start', '--hostname', '127.0.0.1', '--port', String(port)],
  {
    cwd: readerDirectory,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  }
);
const output = { text: '' };
for (const stream of [reader.stdout, reader.stderr])
  stream.on('data', (chunk) => {
    output.text = `${output.text}${chunk}`.slice(-32000);
  });
try {
  const deadline = Date.now() + 30000;
  const readiness = { ready: false };
  while (Date.now() < deadline && reader.exitCode === null) {
    try {
      readiness.ready = (await fetch(`http://127.0.0.1:${port}/en`)).ok;
    } catch (failure) {
      if (!(failure instanceof TypeError)) throw failure;
    }
    if (readiness.ready) break;
    await pollDelay(100);
  }
  assert.ok(readiness.ready, `Packed reader did not start: ${sanitizeCommandOutput(output.text)}`);
  const result = await runSafeCommand(
    'pnpm',
    [
      '--filter',
      '@gt/acceptance',
      'exec',
      'playwright',
      'test',
      'e2e/reader.spec.ts',
      'e2e/publishing.spec.ts',
      'e2e/editor-controls.spec.ts',
      'e2e/jobs-permissions.spec.ts',
      'e2e/editor-tour.spec.ts',
      'e2e/accessibility.spec.ts',
    ],
    {
      cwd: root,
      env: browserChildEnvironment(
        {
          ...environment,
          ADMIN_URL: origin.origin,
          READER_PORT: String(port),
          TESTBED_ACCOUNT_FILE: accountFile,
          TESTBED_MOCK_CONTROL_FILE: process.env.TESTBED_MOCK_CONTROL_FILE,
          TESTBED_EXTERNAL_SERVER: 'true',
        },
        process.env
      ),
      timeout: 900000,
      maxBuffer: 4000000,
    }
  );
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.stdout.write(
    'Packed production app passed the shared editor and reader acceptance suites.\n'
  );
} finally {
  await stopOwnedProcessGroup(reader);
}
