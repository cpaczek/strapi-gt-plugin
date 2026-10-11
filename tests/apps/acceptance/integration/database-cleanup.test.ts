import { randomBytes } from 'node:crypto';
import { createConnection } from 'node:net';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { cleanupTestResources } from '../src/cleanup-resources';
import { createTestDatabase } from '../src/database';
import { startMockGt, type MockGtServer } from '../src/mock-gt';

const listening = (port: number): Promise<boolean> =>
  new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', (failure) => {
      if ('code' in failure && failure.code === 'ECONNREFUSED') resolve(false);
      else reject(failure);
    });
    socket.setTimeout(1000, () =>
      socket.destroy(new Error('Owned database listener did not respond'))
    );
  });

it('closes the owned mock and database after earlier teardown failures', async () => {
  const root = resolve(import.meta.dirname, '../../../..');
  const database = await createTestDatabase(root, process.env.DATABASE_CLIENT ?? 'sqlite');
  const closed = { database: false, mock: false };
  const resources: { mock?: MockGtServer } = {};
  const strapiFailure = new Error('Injected Strapi shutdown failure');
  const mockFailure = new Error('Injected mock shutdown failure');
  const databasePort = database.environment.DATABASE_PORT;
  try {
    const mock = await startMockGt({ apiKey: randomBytes(32).toString('hex') });
    resources.mock = mock;
    if (databasePort) expect(await listening(Number(databasePort))).toBe(true);
    const result = await cleanupTestResources([
      async () => {
        throw strapiFailure;
      },
      async () => {
        await mock.close();
        closed.mock = true;
        throw mockFailure;
      },
      async () => {
        await database.close();
        closed.database = true;
      },
    ]).catch((failure: unknown) => failure);
    expect(result).toBeInstanceOf(AggregateError);
    if (!(result instanceof AggregateError)) throw new Error('Teardown failures were not retained');
    expect(result.errors).toEqual([strapiFailure, mockFailure]);
    expect(result.cause).toBe(strapiFailure);
    expect(closed).toEqual({ database: true, mock: true });
    if (databasePort) await expect.poll(() => listening(Number(databasePort))).toBe(false);
    await expect.poll(() => listening(Number(new URL(mock.url).port))).toBe(false);
  } finally {
    await cleanupTestResources([
      async () => {
        if (!closed.mock) await resources.mock?.close();
      },
      async () => {
        if (!closed.database) await database.close();
      },
    ]);
  }
});
