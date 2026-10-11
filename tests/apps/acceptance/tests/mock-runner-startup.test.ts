import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import type { MockGtServer } from '../src/mock-gt';

const state = vi.hoisted(() => {
  const value: {
    phase: 'write' | 'chmod' | 'smoke'; failure: Error; closeFailure?: Error;
    servers: MockGtServer[]; closed: Set<string>; directories: string[];
  } = { phase: 'write', failure: new Error('Injected runner setup failure'), servers: [], closed: new Set(), directories: [] };
  return value;
});
vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return { ...original,
    readFile: async (...args: Parameters<typeof original.readFile>) =>
      String(args[0]).endsWith('/.work/testbed/local.json') ? JSON.stringify({ mockKey: 'synthetic-runner-key' }) : original.readFile(...args),
    mkdtemp: async (...args: Parameters<typeof original.mkdtemp>) => {
      const directory = await original.mkdtemp(...args);
      if (typeof directory === 'string') state.directories.push(directory);
      return directory;
    },
    writeFile: async (...args: Parameters<typeof original.writeFile>) => {
      if (state.phase === 'write' && String(args[0]).endsWith('/mock-control.json')) throw state.failure;
      if (String(args[0]).endsWith('/.work/testbed/mock-control.json')) return;
      await original.writeFile(...args);
    },
    chmod: async (...args: Parameters<typeof original.chmod>) => {
      if (state.phase === 'chmod' && String(args[0]).endsWith('/mock-control.json')) throw state.failure;
      await original.chmod(...args);
    },
  };
});
vi.mock('../src/mock-gt', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/mock-gt')>();
  return { ...original, startMockGt: async (...args: Parameters<typeof original.startMockGt>) => {
    const server = await original.startMockGt({ ...args[0], port: 0 });
    state.servers.push(server);
    return { ...server, close: async () => {
      await server.close(); state.closed.add(server.url);
      if (state.closeFailure) throw state.closeFailure;
    } };
  } };
});
vi.mock('../../../../scripts/testbed/safe-command.mjs', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../../scripts/testbed/safe-command.mjs')>();
  return { ...original, runSafeCommand: async (_command: string, args: string[]) => {
    const fs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    if (args.includes('pack')) {
      const destination = args.at(-1);
      if (!destination) throw new Error('The test pack command has no destination');
      await fs.writeFile(resolve(destination, 'fixture.tgz'), 'packed fixture');
    }
    if (args[0] === 'dlx' && args[2]) await fs.mkdir(args[2], { recursive: true });
    if (args[0] === 'smoke') throw state.failure;
    return { stdout: '', stderr: '' };
  } };
});
afterEach(async () => {
  for (const server of state.servers) if (!state.closed.has(server.url)) await server.close();
  const fs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  for (const directory of state.directories) await fs.rm(directory, { recursive: true, force: true });
  state.servers.length = 0; state.directories.length = 0; state.closed.clear(); state.closeFailure = undefined;
  vi.unstubAllEnvs(); vi.resetModules();
});
describe('mock runner startup ownership', () => {
  it.each(['write', 'chmod'] as const)('closes the recording runner listener when control %s fails', async (phase) => {
    state.phase = phase; vi.stubEnv('TESTBED_MOCK_CONTROLS', 'true');
    await expect(import('../src/run-mock')).rejects.toBe(state.failure);
    expect(state.servers).toHaveLength(1);
    expect(state.closed.size).toBe(1);
  });
  it.each(['write', 'smoke'] as const)('closes the packed runner listener after %s fails', async (phase) => {
    state.phase = phase;
    await expect(import('../src/fresh-install')).rejects.toBe(state.failure);
    expect(state.servers).toHaveLength(1);
    expect(state.closed.size).toBe(1);
  });
  it('retains both packed setup and mock shutdown errors', async () => {
    state.phase = 'write'; state.closeFailure = new Error('Injected runner close failure');
    const failure = await import('../src/fresh-install').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    if (!(failure instanceof AggregateError)) throw new Error('Packed startup failure was replaced');
    expect(failure.errors).toEqual([state.failure, state.closeFailure]);
    expect(failure.cause).toBe(state.failure);
    expect(state.closed.size).toBe(1);
  });
});
