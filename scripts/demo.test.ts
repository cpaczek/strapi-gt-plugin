import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { chmod, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
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
  const runner = spawn(process.execPath, ['--import', 'tsx', resolve('scripts/testbed/demo.ts')], {
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

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (failure) {
    if (failure instanceof Error && 'code' in failure && failure.code === 'ESRCH') return false;
    throw failure;
  }
};
const lifecycleProbe = async (
  options: { missingPnpm?: boolean; disappearingGroup?: boolean } = {}
) => {
  const directory = await mkdtemp(join(tmpdir(), 'gt-demo-lifecycle-'));
  await symlink(process.execPath, join(directory, 'node'));
  if (!options.missingPnpm) {
    const executable = join(directory, 'pnpm');
    await writeFile(
      executable,
      `#!/usr/bin/env node
const { createServer } = require('node:http');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
const server = createServer();
server.listen(0, '127.0.0.1', () => {
  writeFileSync(join(process.env.DEMO_PROBE_DIR, 'child-' + process.pid + '.json'), '{}');
});
process.once('SIGTERM', () => server.close());
process.once('SIGUSR2', () => server.close());
`
    );
    await chmod(executable, 0o700);
  }
  const preload = join(directory, 'disappearing-group.mjs');
  await writeFile(
    preload,
    `import process from 'node:process';
const originalKill = process.kill.bind(process);
process.kill = (pid, signal) => {
  const result = originalKill(pid, signal);
  if (pid < 0) throw Object.assign(new Error('The task-owned process group disappeared'), { code: 'ESRCH' });
  return result;
};
`
  );
  const runner = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      ...(options.disappearingGroup ? ['--import', pathToFileURL(preload).href] : []),
      resolve('scripts/testbed/demo.ts'),
    ],
    {
      env: { ...process.env, PATH: directory, DEMO_PROBE_DIR: directory },
      stdio: ['ignore', 'ignore', 'pipe'],
    }
  );
  const exit = once(runner, 'exit');
  const output = { diagnostic: false, unhandled: false };
  runner.stderr.on('data', (chunk: Buffer) => {
    output.diagnostic ||= chunk.toString().includes('General Translation:');
    output.unhandled ||= /triggerUncaughtException|UnhandledPromiseRejection/.test(
      chunk.toString()
    );
  });
  const pids = async (): Promise<number[]> =>
    (await readdir(directory))
      .filter((name) => /^child-\d+\.json$/.test(name))
      .map((name) => Number(name.slice(6, -5)));
  const waitForExit = async (): Promise<number | null> => {
    await vi.waitFor(
      () => expect(runner.exitCode !== null || runner.signalCode !== null).toBe(true),
      { timeout: 5_000 }
    );
    await exit;
    return runner.exitCode;
  };
  const ready = async (): Promise<number[]> => {
    await vi.waitFor(async () => expect(await pids()).toHaveLength(3), { timeout: 5_000 });
    return pids();
  };
  const noOrphans = async (): Promise<void> => {
    await vi.waitFor(async () => expect((await pids()).some(alive)).toBe(false), {
      timeout: 5_000,
    });
  };
  const cleanup = async (): Promise<void> => {
    for (const pid of await pids()) {
      if (alive(pid)) process.kill(pid, 'SIGTERM');
    }
    if (runner.exitCode === null && runner.signalCode === null) runner.kill('SIGTERM');
    await waitForExit();
    await noOrphans();
    await rm(directory, { recursive: true, force: true });
  };
  return { runner, output, pids, ready, waitForExit, noOrphans, cleanup };
};

it('fails promptly when pnpm cannot spawn and leaves no children', async () => {
  const probe = await lifecycleProbe({ missingPnpm: true });
  try {
    expect(await probe.waitForExit()).not.toBe(0);
    expect(probe.output.diagnostic).toBe(true);
    expect(probe.output.unhandled).toBe(false);
    expect(await probe.pids()).toEqual([]);
  } finally {
    await probe.cleanup();
  }
});

it('reports an unexpected child exit zero as failure and cleans up siblings', async () => {
  const probe = await lifecycleProbe();
  try {
    const [child] = await probe.ready();
    if (child === undefined) throw new Error('The owned child did not start');
    process.kill(child, 'SIGUSR2');
    expect(await probe.waitForExit()).not.toBe(0);
    await probe.noOrphans();
  } finally {
    await probe.cleanup();
  }
});

it.each([false, true])(
  'keeps intentional SIGTERM successful when a group disappears: %s',
  async (disappearingGroup) => {
    const probe = await lifecycleProbe({ disappearingGroup });
    try {
      await probe.ready();
      probe.runner.kill('SIGTERM');
      expect(await probe.waitForExit()).toBe(0);
      expect(probe.output.unhandled).toBe(false);
      await probe.noOrphans();
    } finally {
      await probe.cleanup();
    }
  }
);
