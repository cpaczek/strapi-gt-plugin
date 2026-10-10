import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const setup = spawn(process.execPath, [resolve(root, 'scripts/testbed/setup-local.mjs')], {
  cwd: root,
  stdio: 'inherit',
});
const [setupCode] = await once(setup, 'exit');
if (setupCode !== 0) throw new Error('Local example settings could not be prepared');
const environment = {
  ...process.env,
  NODE_ENV: 'production',
  STRAPI_TELEMETRY_DISABLED: 'true',

  NEXT_TELEMETRY_DISABLED: '1',
};
if (process.argv.includes('--isolated')) {
  await mkdir(resolve(root, '.work/testbed/runs'), { recursive: true });
  const directory = await mkdtemp(resolve(root, '.work/testbed/runs/browser-'));
  environment.DATABASE_CLIENT = 'sqlite';
  environment.DATABASE_FILENAME = resolve(directory, 'database.db');
}
const commands = [
  ['--filter', '@gt/acceptance', 'mock'],
  ['--filter', '@gt/playground', 'start'],
  ['--filter', '@gt/reader', 'start'],
];
const children = commands.map((args) =>
  spawn('pnpm', args, { cwd: root, env: environment, stdio: 'inherit', detached: true })
);
const state = { closing: false };
const stop = async (code) => {
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
    process.stderr.write(`${error.message}\n`);
    void stop(1);
  });
  child.once('exit', (code) => {
    if (!state.closing) void stop(code ?? 1);
  });
}
