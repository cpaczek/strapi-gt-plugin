import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { vi } from 'vitest';

const execute = promisify(execFile);
export interface TestDatabase {
  environment: Record<string, string>;
  close: () => Promise<void>;
}
export const createTestDatabase = async (root: string, client: string): Promise<TestDatabase> => {
  await mkdir(resolve(root, '.work/testbed'), { recursive: true });
  const directory = await mkdtemp(resolve(root, '.work/testbed/database-'));
  if (client === 'sqlite')
    return {
      environment: {
        DATABASE_CLIENT: 'sqlite',
        DATABASE_FILENAME: resolve(directory, 'database.db'),
      },
      close: async () => {},
    };
  if (client !== 'postgres' && client !== 'mysql')
    throw new TypeError('DATABASE_CLIENT must be sqlite, postgres, or mysql');
  const runtime = process.env.CONTAINER_RUNTIME ?? 'docker';
  if (!['docker', 'podman'].includes(runtime))
    throw new TypeError('CONTAINER_RUNTIME must be docker or podman');
  const name = `gt-test-${client}-${randomBytes(8).toString('hex')}`;
  const password = randomBytes(32).toString('hex');
  const environment = {
    DATABASE_CLIENT: client,
    DATABASE_HOST: '127.0.0.1',
    DATABASE_USERNAME: 'editorial',
    DATABASE_NAME: 'editorial',
    DATABASE_PASSWORD: password,
  };
  const envPath = resolve(directory, 'container.env');
  const lines =
    client === 'postgres'
      ? [`POSTGRES_USER=editorial`, 'POSTGRES_DB=editorial', `POSTGRES_PASSWORD=${password}`]
      : [
          'MYSQL_USER=editorial',
          'MYSQL_DATABASE=editorial',
          `MYSQL_PASSWORD=${password}`,
          `MYSQL_ROOT_PASSWORD=${randomBytes(32).toString('hex')}`,
        ];
  await writeFile(envPath, `${lines.join('\n')}\n`, { mode: 0o600 });
  const containerPort = client === 'postgres' ? '5432' : '3306';
  const image = client === 'postgres' ? 'postgres:17' : 'mysql:8.4';
  await execute(
    runtime,
    [
      'run',
      '--detach',
      '--rm',
      '--name',
      name,
      '--publish',
      `127.0.0.1::${containerPort}`,
      '--env-file',
      envPath,
      image,
    ],
    { timeout: 240_000 }
  );
  const close = async () => {
    await execute(runtime, ['stop', name], { timeout: 30_000 });
  };
  try {
    await vi.waitUntil(
      async () => {
        try {
          await execute(
            runtime,
            [
              'exec',
              name,
              ...(client === 'postgres'
                ? ['pg_isready', '-h', '127.0.0.1', '-U', 'editorial', '-d', 'editorial']
                : ['mysqladmin', '--protocol=tcp', '--host=127.0.0.1', 'ping', '--silent']),
            ],
            { timeout: 5_000 }
          );
          return true;
        } catch (failure) {
          if (failure instanceof Error && 'code' in failure && typeof failure.code === 'number')
            return false;
          throw failure;
        }
      },
      { timeout: 180_000, interval: 500 }
    );
    const portResult = await execute(runtime, ['port', name, `${containerPort}/tcp`]);
    const match = /127\.0\.0\.1:(\d+)/.exec(portResult.stdout);
    if (!match?.[1]) throw new Error('Container did not expose a loopback database port');
    return { environment: { ...environment, DATABASE_PORT: match[1] }, close };
  } catch (failure) {
    await close();
    throw failure;
  }
};
