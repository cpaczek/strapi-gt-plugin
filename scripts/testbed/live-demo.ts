import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { loadEnvFile } from 'node:process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GT_BASE_URL,
  LIVE_READER_PORT,
  LIVE_STRAPI_PORT,
} from '../../packages/plugin/shared/constants';
import { buildMessage, formatUnknownError, messages } from '../../packages/plugin/shared/messages';

interface LiveProcess {
  args: string[];
  env: NodeJS.ProcessEnv;
}

const port = (value: string | undefined, fallback: number): string => {
  const selected = value ?? String(fallback);
  if (!/^\d+$/.test(selected) || Number(selected) < 1 || Number(selected) > 65535)
    throw new Error(
      messages.validation('Set live demo ports to integers between 1 and 65535').text
    );
  return String(Number(selected));
};

export const createLiveProcesses = (
  root: string,
  environment: NodeJS.ProcessEnv
): [LiveProcess, LiveProcess] => {
  for (const name of ['GT_API_KEY', 'GT_PROJECT_ID'])
    if (!environment[name]?.trim())
      throw new Error(
        messages.validation(`Set ${name} in the ignored root .env before starting the live demo`)
          .text
      );
  const strapiPort = port(environment.LIVE_STRAPI_PORT, LIVE_STRAPI_PORT);
  const readerPort = port(environment.LIVE_READER_PORT, LIVE_READER_PORT);
  if (strapiPort === readerPort)
    throw new Error(
      messages.validation('Choose different Strapi and Next.js ports for the live demo').text
    );
  const readerEnvironment = Object.fromEntries(
    Object.entries(environment).filter(
      ([key]) => !key.startsWith('GT_') && key !== 'STRAPI_API_TOKEN'
    )
  );
  return [
    {
      args: ['--filter', '@gt/playground', 'start'],
      env: {
        ...environment,
        HOST: '127.0.0.1',
        NODE_ENV: 'production',
        PORT: strapiPort,
        DATABASE_CLIENT: 'sqlite',
        DATABASE_FILENAME: resolve(root, '.work/live-demo/database.db'),
        PLAYGROUND_SEED: 'true',
        GT_BASE_URL,
        STRAPI_TELEMETRY_DISABLED: 'true',
      },
    },
    {
      args: ['--filter', '@gt/reader', 'start'],
      env: {
        ...readerEnvironment,
        NODE_ENV: 'production',
        STRAPI_URL: `http://127.0.0.1:${strapiPort}`,
        READER_PORT: readerPort,
        NEXT_TELEMETRY_DISABLED: '1',
      },
    },
  ];
};

const run = async (): Promise<void> => {
  const root = resolve(import.meta.dirname, '../..');
  const envPath = resolve(root, '.env');
  if (existsSync(envPath)) loadEnvFile(envPath);
  const processes = createLiveProcesses(root, process.env);
  const setup = spawn(process.execPath, [resolve(root, 'scripts/testbed/setup-local.mjs')], {
    cwd: root,
    env: processes[1].env,
    stdio: 'inherit',
  });
  const [setupCode] = await once(setup, 'exit');
  if (setupCode !== 0)
    throw new Error(messages.validation('Local example settings could not be prepared').text);
  await mkdir(resolve(root, '.work/live-demo'), { recursive: true });
  process.stdout.write(
    buildMessage({
      code: 'live-demo',
      level: 'warning',
      happened: 'Live GT mode is enabled',
      why: 'Translation requests use your GT account',
      fix: 'Review target locales before translating',
    }).text + '\n'
  );
  const children = processes.map(({ args, env }) =>
    spawn('pnpm', args, { cwd: root, env, stdio: 'inherit', detached: true })
  );
  const state = { closing: false };
  const stop = async (code: number): Promise<void> => {
    if (state.closing) return;
    state.closing = true;
    for (const child of children) {
      if (child.pid && child.exitCode === null) {
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch (failure) {
          if (!(failure instanceof Error && 'code' in failure && failure.code === 'ESRCH'))
            throw failure;
        }
      }
    }
    await Promise.all(
      children.map((child) =>
        child.pid && child.exitCode === null ? once(child, 'exit') : Promise.resolve()
      )
    );
    process.exitCode = code;
  };
  const report = (failure: unknown): void => {
    process.stderr.write(
      buildMessage({
        code: 'live-demo-failed',
        happened: 'The live demo could not continue',
        fix: 'Check the local server output and port settings',
        details: { reason: formatUnknownError(failure) },
      }).text + '\n'
    );
    process.exitCode = 1;
  };
  process.once('SIGINT', () => {
    void stop(0).catch(report);
  });
  process.once('SIGTERM', () => {
    void stop(0).catch(report);
  });
  for (const child of children) {
    child.once('error', (failure) => {
      report(failure);
      void stop(1).catch(report);
    });
    child.once('exit', (code) => {
      if (!state.closing) void stop(code || 1).catch(report);
    });
  }
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await run();
