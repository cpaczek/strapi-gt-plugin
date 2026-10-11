import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { stopOwnedProcessGroup } from '../../../../scripts/testbed/owned-process.mjs';

const listenerSchema = z.object({
  pid: z.number().int().min(2),
  port: z.number().int().min(1).max(65535),
});
type Listener = z.infer<typeof listenerSchema>;
const readListener = async (file: string): Promise<Listener> =>
  listenerSchema.parse(JSON.parse(await readFile(file, 'utf8')));
const serves = async (listener: Listener): Promise<boolean> => {
  try {
    const result = await fetch(`http://127.0.0.1:${listener.port}`, {
      signal: AbortSignal.timeout(1000),
    });
    return result.ok && (await result.text()) === String(listener.pid);
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
const signalGroup = (pid: number): void => {
  try {
    process.kill(-pid, 'SIGTERM');
  } catch (failure) {
    if (!(failure instanceof Error && 'code' in failure && failure.code === 'ESRCH')) throw failure;
  }
};

const endings = ['running', 'exited', 'killed'] as const;
describe('packed runner owned process groups', () => {
  it.each(endings)(
    'stops descendants with the leader %s and preserves an unrelated listener',
    async (ending) => {
      const directory = await mkdtemp(resolve(tmpdir(), 'gt-packed-descendants-'));
      const listenerScript = resolve(directory, 'listener.cjs');
      const leaderScript = resolve(directory, 'leader.cjs');
      const ownedRecord = resolve(directory, 'owned.json');
      const sentinelRecord = resolve(directory, 'sentinel.json');
      await writeFile(
        listenerScript,
        `const { createServer } = require('node:http');
const { writeFileSync } = require('node:fs');
const server = createServer((_request, response) => { response.setHeader('Connection', 'close'); response.end(String(process.pid)); });
server.listen(0, '127.0.0.1', () => writeFileSync(process.env.RECORD, JSON.stringify({pid: process.pid, port: server.address().port})));
process.on('SIGTERM', () => server.close(() => process.exitCode = 0));
`
      );
      await writeFile(
        leaderScript,
        `const { spawn } = require('node:child_process');
spawn(process.execPath, [process.env.LISTENER], { env: process.env, stdio: 'ignore' });
process.on('SIGUSR2', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
`
      );
      const sentinel = spawn(process.execPath, [listenerScript], {
        env: { RECORD: sentinelRecord },
        detached: true,
        stdio: 'ignore',
      });
      const sentinelExit = once(sentinel, 'exit');
      const leader = spawn(process.execPath, [leaderScript], {
        env: { LISTENER: listenerScript, RECORD: ownedRecord },
        detached: true,
        stdio: 'ignore',
      });
      const leaderExit = once(leader, 'exit');
      try {
        const owned = await vi.waitFor(() => readListener(ownedRecord), { timeout: 5000 });
        const unrelated = await vi.waitFor(() => readListener(sentinelRecord), { timeout: 5000 });
        expect(await serves(owned)).toBe(true);
        expect(await serves(unrelated)).toBe(true);
        if (ending !== 'running') {
          leader.kill(ending === 'killed' ? 'SIGKILL' : 'SIGUSR2');
          await leaderExit;
          expect(await serves(owned)).toBe(true);
        }
        const completion = { finished: false };
        const stopped = stopOwnedProcessGroup(leader).then(() => {
          completion.finished = true;
        });
        await vi.waitFor(() => expect(completion.finished).toBe(true), { timeout: 1000 });
        await stopped;
        await leaderExit;
        await vi.waitFor(async () => expect(await serves(owned)).toBe(false), { timeout: 5000 });
        expect(await serves(unrelated)).toBe(true);
        await expect(stopOwnedProcessGroup(leader)).resolves.toBeUndefined();
      } finally {
        if (leader.pid) signalGroup(leader.pid);
        if (sentinel.pid) signalGroup(sentinel.pid);
        await leaderExit;
        await sentinelExit;
        await rm(directory, { recursive: true, force: true });
      }
    },
    15000
  );
});
