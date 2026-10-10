import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { expect, it, vi } from 'vitest';

it('starts built mock apps with credentials limited to Strapi', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gt-demo-launch-'));
  const executable = join(directory, 'pnpm');
  await writeFile(
    executable,
    `#!/usr/bin/env node
const { createServer } = require('node:http');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const server = createServer();
server.listen(0, '127.0.0.1', () => {
  const settings = JSON.parse(readFileSync(process.env.DEMO_PROBE_SETTINGS_FILE, 'utf8'));
  writeFileSync(join(process.env.DEMO_PROBE_DIR, process.pid + '.json'), JSON.stringify({
    args: process.argv.slice(2),
    mode: process.env.NODE_ENV,
    hasGtEnvironment: Object.keys(process.env).some((name) => name.startsWith('GT_')),
    hasExtraGtEnvironment: Object.keys(process.env).some((name) => name.startsWith('GT_') && !['GT_API_KEY', 'GT_PROJECT_ID', 'GT_BASE_URL'].includes(name)),
    hasReaderToken: 'STRAPI_API_TOKEN' in process.env,
    usesMockKey: process.env.GT_API_KEY === settings.mockKey,
    usesMockProject: process.env.GT_PROJECT_ID === 'editorial',
    usesMockUrl: process.env.GT_BASE_URL === 'http://127.0.0.1:4100',
    preservesControls: process.env.TESTBED_MOCK_CONTROLS === 'true' && process.env.TESTBED_MOCK_CONTROL_FILE === process.env.DEMO_PROBE_CONTROL_FILE,
  }));
});
process.once('SIGTERM', () => server.close());
`
  );
  await chmod(executable, 0o700);
  const runner = spawn(process.execPath, [resolve('scripts/testbed/demo.mjs')], {
    env: {
      ...process.env,
      PATH: `${directory}:${dirname(process.execPath)}:${process.env.PATH ?? ''}`,
      DEMO_PROBE_DIR: directory,
      DEMO_PROBE_SETTINGS_FILE: resolve('.work/testbed/local.json'),
      DEMO_PROBE_CONTROL_FILE: join(directory, 'mock-control.json'),
      GT_API_KEY: randomBytes(32).toString('hex'),
      GT_PROJECT_ID: 'inherited-test-project',
      GT_BASE_URL: 'http://127.0.0.1:49999',
      GT_OTHER_SECRET: randomBytes(32).toString('hex'),
      STRAPI_API_TOKEN: randomBytes(32).toString('hex'),
      TESTBED_MOCK_CONTROLS: 'true',
      TESTBED_MOCK_CONTROL_FILE: join(directory, 'mock-control.json'),
    },
    stdio: 'ignore',
  });
  const exited = once(runner, 'exit');
  try {
    await vi.waitFor(
      async () => {
        expect((await readdir(directory)).filter((name) => name.endsWith('.json'))).toHaveLength(3);
      },
      { timeout: 10_000 }
    );
    const records: unknown[] = await Promise.all(
      (await readdir(directory))
        .filter((name) => name.endsWith('.json'))
        .map(async (name) => JSON.parse(await readFile(join(directory, name), 'utf8')))
    );
    expect(records).toContainEqual({
      args: ['--filter', '@gt/playground', 'start'],
      mode: 'production',
      hasGtEnvironment: true,
      hasExtraGtEnvironment: false,
      hasReaderToken: false,
      usesMockKey: true,
      usesMockProject: true,
      usesMockUrl: true,
      preservesControls: true,
    });
    expect(records).toContainEqual({
      args: ['--filter', '@gt/reader', 'start'],
      mode: 'production',
      hasGtEnvironment: false,
      hasExtraGtEnvironment: false,
      hasReaderToken: false,
      usesMockKey: false,
      usesMockProject: false,
      usesMockUrl: false,
      preservesControls: true,
    });
    expect(records).toContainEqual({
      args: ['--filter', '@gt/acceptance', 'mock'],
      mode: 'production',
      hasGtEnvironment: false,
      hasExtraGtEnvironment: false,
      hasReaderToken: false,
      usesMockKey: false,
      usesMockProject: false,
      usesMockUrl: false,
      preservesControls: true,
    });
  } finally {
    if (runner.exitCode === null) runner.kill('SIGTERM');
    await exited;
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);
