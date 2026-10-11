import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { access } from 'node:fs/promises';
import { createConnection } from 'node:net';
import type { MockGtServer } from '../../../../tests/apps/acceptance/src/mock-gt';
import type { createFixtureEvidence } from './fixture-evidence';
import { startStrapiFixture } from './strapi-fixture';

const state = vi.hoisted(() => {
  const value: {
    failPath?: string;
    failure?: Error;
    mockCloseFailure?: Error;
    evidenceCloseFailure?: Error;
    beforeFailure?: () => void;
    directories: string[];
    mocks: MockGtServer[];
    closedMocks: Set<string>;
    evidence: Awaited<ReturnType<typeof createFixtureEvidence>>[];
    closedEvidence: Set<string>;
  } = {
    directories: [],
    mocks: [],
    closedMocks: new Set(),
    evidence: [],
    closedEvidence: new Set(),
  };
  return value;
});
vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...original,
    mkdtemp: async (...args: Parameters<typeof original.mkdtemp>) => {
      const directory = await original.mkdtemp(...args);
      if (typeof directory === 'string' && directory.includes('/server-integration/app-'))
        state.directories.push(directory);
      return directory;
    },
    writeFile: async (...args: Parameters<typeof original.writeFile>) => {
      if (state.failPath && String(args[0]).endsWith(state.failPath)) {
        state.beforeFailure?.();
        throw state.failure;
      }
      return original.writeFile(...args);
    },
  };
});
vi.mock('../../../../tests/apps/acceptance/src/mock-gt', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../../../tests/apps/acceptance/src/mock-gt')>();
  return {
    ...original,
    startMockGt: async (...args: Parameters<typeof original.startMockGt>) => {
      const server = await original.startMockGt(...args);
      state.mocks.push(server);
      return {
        ...server,
        close: async () => {
          await server.close();
          state.closedMocks.add(server.url);
          if (state.mockCloseFailure) throw state.mockCloseFailure;
        },
      };
    },
  };
});
vi.mock('./fixture-evidence', async (importOriginal) => {
  const original = await importOriginal<typeof import('./fixture-evidence')>();
  return {
    createFixtureEvidence: async (...args: Parameters<typeof original.createFixtureEvidence>) => {
      const evidence = await original.createFixtureEvidence(...args);
      state.evidence.push(evidence);
      return {
        ...evidence,
        close: async () => {
          await evidence.close();
          state.closedEvidence.add(evidence.path);
          if (state.evidenceCloseFailure) throw state.evidenceCloseFailure;
        },
      };
    },
  };
});
const fixtureSymbol = Symbol.for('general-translation.real-server-test');
const originalFetch = globalThis.fetch;
const originalGlobals = new Map<PropertyKey, PropertyDescriptor | undefined>();
const event = Symbol('unrelated-startup-listener');
const listener = () => {};
const unrelatedListener = () => {};
const listening = (url: string): Promise<boolean> =>
  new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port: Number(new URL(url).port) });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', (failure) => {
      if ('code' in failure && failure.code === 'ECONNREFUSED') resolve(false);
      else reject(failure);
    });
  });
beforeEach(() => {
  state.failPath = undefined;
  state.failure = undefined;
  state.mockCloseFailure = undefined;
  state.evidenceCloseFailure = undefined;
  state.beforeFailure = undefined;
  for (const key of [fixtureSymbol, 'strapi'])
    originalGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, fixtureSymbol, {
    value: 'prior-fixture',
    configurable: true,
    enumerable: true,
  });
  vi.stubEnv('GT_API_KEY', 'prior-test-key');
  vi.stubEnv('STRAPI_TELEMETRY_DISABLED', 'prior-test-telemetry');
  process.on(event, listener);
});
afterEach(async () => {
  const fs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  for (const mock of state.mocks) if (!state.closedMocks.has(mock.url)) await mock.close();
  for (const evidence of state.evidence)
    if (!state.closedEvidence.has(evidence.path)) await evidence.close();
  for (const directory of state.directories)
    await fs.rm(directory, { recursive: true, force: true });
  state.mocks.length = 0;
  state.evidence.length = 0;
  state.directories.length = 0;
  state.closedMocks.clear();
  state.closedEvidence.clear();
  globalThis.fetch = originalFetch;
  for (const [key, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  process.removeAllListeners(event);
  vi.unstubAllEnvs();
});
const assertRestored = async () => {
  expect(process.env.GT_API_KEY === 'prior-test-key').toBe(true);
  expect(process.env.STRAPI_TELEMETRY_DISABLED === 'prior-test-telemetry').toBe(true);
  expect(Object.getOwnPropertyDescriptor(globalThis, fixtureSymbol)).toEqual({
    value: 'prior-fixture',
    configurable: true,
    enumerable: true,
    writable: false,
  });
  expect(globalThis.fetch).toBe(originalFetch);
  expect(process.rawListeners(event)).toContain(listener);
  for (const mock of state.mocks) expect(await listening(mock.url)).toBe(false);
  for (const directory of state.directories) await expect(access(directory)).rejects.toThrow();
};
describe('Strapi fixture acquisition failures', () => {
  it.each([
    '/package.json',
    '/plugin/package.json',
    '/plugin/server.js',
    '/config/plugins.js',
    '/config/server.js',
    '/config/admin.js',
    '/config/logger.js',
    '/config/database.js',
    '/src/components/editorial/card.json',
    '/src/api/article/content-types/article/schema.json',
    '/src/api/note/content-types/note/schema.json',
    '/src/index.js',
  ])('restores owned state when writing %s fails', async (path) => {
    const failure = new Error('Injected fixture filesystem failure');
    state.failPath = path;
    state.failure = failure;
    await expect(startStrapiFixture()).rejects.toBe(failure);
    await assertRestored();
  });
  it('closes the mock and removes its directory when evidence creation fails', async () => {
    state.failPath = '.jsonl';
    state.failure = new Error('Injected evidence filesystem failure');
    await expect(startStrapiFixture()).rejects.toBe(state.failure);
    await assertRestored();
  });
  it('retains startup and cleanup errors while restoring unrelated state', async () => {
    state.failPath = '/package.json';
    state.failure = new Error('Injected setup failure');
    state.mockCloseFailure = new Error('Injected mock close failure');
    state.evidenceCloseFailure = new Error('Injected evidence close failure');
    state.beforeFailure = () => {
      process.removeListener(event, listener);
      process.on(event, unrelatedListener);
    };
    const failure = await startStrapiFixture().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    if (!(failure instanceof AggregateError)) throw new Error('Startup failure was not retained');
    expect(failure.errors[0]).toBe(state.failure);
    expect(failure.cause).toBe(state.failure);
    await assertRestored();
    expect(process.rawListeners(event)).toContain(unrelatedListener);
  });
  it('restores prior global descriptors after a successful real fixture', async () => {
    const fixture = await startStrapiFixture();
    await fixture.close();
    await assertRestored();
    expect(Object.getOwnPropertyDescriptor(globalThis, 'strapi')).toEqual(
      originalGlobals.get('strapi')
    );
  }, 30000);
});
