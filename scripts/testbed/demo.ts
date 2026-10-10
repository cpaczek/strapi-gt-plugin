import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildMessage, formatUnknownError } from '../../packages/plugin/shared/messages';

const root = resolve(import.meta.dirname, '../..');
const environment: NodeJS.ProcessEnv = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !name.startsWith('GT_') && name !== 'STRAPI_API_TOKEN'
    )
  ),
  NODE_ENV: 'production',
  STRAPI_TELEMETRY_DISABLED: 'true',
  NEXT_TELEMETRY_DISABLED: '1',
};
const configurationFailure = (): Error =>
  new Error(
    buildMessage({
      code: 'mock-demo-configuration',
      happened: 'The mock demo could not load its local configuration',
      why: 'The ignored local setup is incomplete or could not be read',
      fix: 'Restore the local testbed settings and playground environment together, then run pnpm demo again',
      fallback: 'The mock services were not started',
    }).text
  );
const setup = spawn(process.execPath, [resolve(root, 'scripts/testbed/setup-local.mjs')], {
  cwd: root,
  env: environment,
  stdio: 'inherit',
});
const [setupCode] = await once(setup, 'exit');
if (setupCode !== 0) throw configurationFailure();
const readMockKey = async (): Promise<string> => {
  try {
    const settings: unknown = JSON.parse(
      await readFile(resolve(root, '.work/testbed/local.json'), 'utf8')
    );
    if (
      typeof settings === 'object' &&
      settings !== null &&
      'mockKey' in settings &&
      typeof settings.mockKey === 'string' &&
      settings.mockKey.trim().length > 0
    )
      return settings.mockKey;
  } catch {
    throw configurationFailure();
  }
  throw configurationFailure();
};
const mockKey = await readMockKey();
if (process.argv.includes('--isolated')) {
  await mkdir(resolve(root, '.work/testbed/runs'), { recursive: true });
  const directory = await mkdtemp(resolve(root, '.work/testbed/runs/browser-'));
  environment.DATABASE_CLIENT = 'sqlite';
  environment.DATABASE_FILENAME = resolve(directory, 'database.db');
}
const commands = [
  { args: ['--filter', '@gt/acceptance', 'mock'], env: environment },
  {
    args: ['--filter', '@gt/playground', 'start'],
    env: {
      ...environment,
      GT_API_KEY: mockKey,
      GT_PROJECT_ID: 'editorial',
      GT_BASE_URL: 'http://127.0.0.1:4100',
    },
  },
  { args: ['--filter', '@gt/reader', 'start'], env: environment },
];
const children = commands.map(({ args, env }) =>
  spawn('pnpm', args, { cwd: root, env, stdio: 'inherit', detached: true })
);
const state = { closing: false };
const stop = async (code: number): Promise<void> => {
  if (state.closing) return;
  state.closing = true;
  for (const child of children) {
    if (child.pid && child.exitCode === null) process.kill(-child.pid, 'SIGTERM');
  }
  await Promise.all(
    children.map((child) => (child.exitCode === null ? once(child, 'exit') : Promise.resolve()))
  );
  process.exitCode = code;
};
process.once('SIGINT', () => {
  void stop(0);
});
process.once('SIGTERM', () => {
  void stop(0);
});
for (const child of children) {
  child.once('error', (error) => {
    process.stderr.write(
      `${
        buildMessage({
          code: 'mock-demo-process',
          happened: 'The mock demo could not start a local process',
          why: formatUnknownError(error),
          fix: 'Run pnpm install and pnpm build, then try pnpm demo again',
          fallback: 'The other mock services will stop',
        }).text
      }\n`
    );
    void stop(1);
  });
  child.once('exit', (code) => {
    if (!state.closing) void stop(code ?? 1);
  });
}
