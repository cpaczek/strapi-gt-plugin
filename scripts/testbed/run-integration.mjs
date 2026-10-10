import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const child = spawn('pnpm', ['exec', 'vitest', 'run', '--config', 'vitest.integration.config.ts'], {
  cwd: resolve(root, 'tests/apps/acceptance'),
  env: { ...process.env, NODE_PATH: resolve(root, 'playground/node_modules') },
  stdio: 'inherit',
});
process.once('SIGINT', () => child.kill('SIGINT'));
process.once('SIGTERM', () => child.kill('SIGTERM'));
const [code] = await once(child, 'exit');
process.exitCode = typeof code === 'number' ? code : 1;
