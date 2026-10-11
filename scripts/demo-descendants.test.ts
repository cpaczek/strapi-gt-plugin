import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

interface ListenerRecord {
  pid: number;
  port: number;
  leader: number;
}
const isListenerRecord = (value: unknown): value is ListenerRecord =>
  typeof value === 'object' &&
  value !== null &&
  'pid' in value &&
  typeof value.pid === 'number' &&
  Number.isSafeInteger(value.pid) &&
  value.pid > 1 &&
  'port' in value &&
  typeof value.port === 'number' &&
  Number.isSafeInteger(value.port) &&
  value.port > 0 &&
  value.port < 65536 &&
  'leader' in value &&
  typeof value.leader === 'number' &&
  Number.isSafeInteger(value.leader) &&
  value.leader > 1;
const readListener = async (path: string): Promise<ListenerRecord> => {
  const record: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (!isListenerRecord(record))
    throw new TypeError('The owned listener did not publish a valid record');
  return record;
};
const serves = async (listener: ListenerRecord): Promise<boolean> => {
  try {
    const response = await fetch(`http://127.0.0.1:${listener.port}`, {
      signal: AbortSignal.timeout(1_000),
    });
    return response.ok && (await response.text()) === `listener:${listener.pid}`;
  } catch (failure) {
    if (
      failure instanceof TypeError &&
      failure.cause instanceof Error &&
      'code' in failure.cause &&
      failure.cause.code === 'ECONNREFUSED'
    )
      return false;
    throw failure;
  }
};
const signalGroup = (leader: number): void => {
  try {
    process.kill(-leader, 'SIGTERM');
  } catch (failure) {
    if (!(failure instanceof Error && 'code' in failure && failure.code === 'ESRCH')) throw failure;
  }
};
const running = (child: ChildProcess): boolean =>
  child.exitCode === null && child.signalCode === null;
const waitForExit = async (child: ChildProcess, exited: Promise<unknown>): Promise<void> => {
  await vi.waitFor(() => expect(running(child)).toBe(false), { timeout: 5_000 });
  await exited;
};

const launchers = [
  { name: 'mock', file: 'demo.ts', children: 3 },
  { name: 'live', file: 'live-demo.ts', children: 2 },
];
const endings = [
  { name: 'wrapper exits normally', signal: 'SIGUSR2', parent: false },
  { name: 'wrapper is killed', signal: 'SIGKILL', parent: false },
  { name: 'parent shuts down intentionally', signal: 'SIGTERM', parent: true },
] satisfies Array<{ name: string; signal: NodeJS.Signals; parent: boolean }>;

describe.each(launchers)('$name launcher process groups', (launcher) => {
  it.each(endings)(
    'stops descendants when $name and preserves an unrelated sentinel',
    async (ending) => {
      const directory = await mkdtemp(join(tmpdir(), 'gt-demo-descendants-'));
      const scripts = join(directory, 'scripts/testbed');
      const bin = join(directory, 'bin');
      const records = join(directory, 'records');
      await Promise.all([mkdir(scripts, { recursive: true }), mkdir(bin), mkdir(records)]);
      await Promise.all([
        cp(resolve('scripts/testbed', launcher.file), join(scripts, launcher.file)),
        cp(resolve('scripts/testbed/setup-local.mjs'), join(scripts, 'setup-local.mjs')),
        symlink(resolve('packages'), join(directory, 'packages'), 'dir'),
        symlink(resolve('node_modules'), join(directory, 'node_modules'), 'dir'),
        symlink(process.execPath, join(bin, 'node')),
        writeFile(join(directory, 'package.json'), JSON.stringify({ type: 'module' })),
        writeFile(join(bin, 'package.json'), JSON.stringify({ type: 'commonjs' })),
      ]);
      const listenerScript = join(directory, 'listener.cjs');
      await writeFile(
        listenerScript,
        `const { createServer } = require('node:http');
const { writeFileSync } = require('node:fs');
const server = createServer((_request, response) => {
  response.setHeader('Connection', 'close');
  response.end('listener:' + process.pid);
});
server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Listener address is unavailable');
  writeFileSync(process.env.LISTENER_RECORD, JSON.stringify({ pid: process.pid, port: address.port, leader: Number(process.env.GROUP_LEADER || process.pid) }));
});
process.once('SIGTERM', () => server.close(() => process.exit(0)));
`
      );
      const pnpm = join(bin, 'pnpm');
      await writeFile(
        pnpm,
        `#!/usr/bin/env node
const { spawn } = require('node:child_process');
const { join } = require('node:path');
spawn(process.execPath, [process.env.LISTENER_SCRIPT], {
  env: { ...process.env, GROUP_LEADER: String(process.pid), LISTENER_RECORD: join(process.env.PROBE_RECORDS, 'listener-' + process.pid + '.json') },
  stdio: 'ignore',
});
process.once('SIGUSR2', () => process.exit(0));
process.once('SIGTERM', () => process.exit(0));
`
      );
      await chmod(pnpm, 0o700);
      const environment: NodeJS.ProcessEnv = {
        PATH: bin,
        LISTENER_SCRIPT: listenerScript,
        PROBE_RECORDS: records,
        GT_API_KEY: randomBytes(32).toString('hex'),
        GT_PROJECT_ID: 'generated-lifecycle-fixture',
      };
      const sentinelRecord = join(directory, 'sentinel.json');
      const sentinel = spawn(process.execPath, [listenerScript], {
        env: { PATH: bin, LISTENER_RECORD: sentinelRecord },
        stdio: 'ignore',
        detached: true,
      });
      const sentinelExited = once(sentinel, 'exit');
      const runner = spawn(process.execPath, ['--import', 'tsx', join(scripts, launcher.file)], {
        cwd: directory,
        env: environment,
        stdio: 'ignore',
      });
      const runnerExited = once(runner, 'exit');
      const descendants = async (): Promise<ListenerRecord[]> =>
        Promise.all((await readdir(records)).map((name) => readListener(join(records, name))));
      const stopped = async (): Promise<void> => {
        await vi.waitFor(
          async () => {
            const active = await Promise.all((await descendants()).map(serves));
            expect(
              active.every((value) => !value),
              'The launcher must stop descendants before fixture cleanup'
            ).toBe(true);
          },
          { timeout: 5_000 }
        );
      };
      try {
        const sentinelListener = await vi.waitFor(() => readListener(sentinelRecord), {
          timeout: 5_000,
        });
        await vi.waitFor(async () => expect(await descendants()).toHaveLength(launcher.children), {
          timeout: 5_000,
        });
        const listeners = await descendants();
        expect(await Promise.all(listeners.map(serves))).toEqual(listeners.map(() => true));
        expect(await serves(sentinelListener)).toBe(true);
        const target = ending.parent ? runner.pid : listeners[0]?.leader;
        if (target === undefined) throw new Error('The owned process did not start');
        process.kill(target, ending.signal);
        await waitForExit(runner, runnerExited);
        expect(runner.exitCode).toBe(ending.parent ? 0 : 1);
        expect(running(sentinel)).toBe(true);
        expect(await serves(sentinelListener)).toBe(true);
        await stopped();
      } finally {
        if (running(runner)) runner.kill('SIGTERM');
        for (const listener of await descendants()) signalGroup(listener.leader);
        await waitForExit(runner, runnerExited);
        await stopped();
        if (sentinel.pid) signalGroup(sentinel.pid);
        await waitForExit(sentinel, sentinelExited);
        await rm(directory, { recursive: true, force: true });
      }
    },
    20_000
  );
});
