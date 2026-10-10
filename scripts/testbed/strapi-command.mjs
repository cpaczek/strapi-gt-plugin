import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';

const child = spawn('pnpm', ['exec', 'strapi', ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env: { ...process.env, NODE_PATH: resolve(process.cwd(), 'node_modules') },
  stdio: 'inherit',
});
process.once('SIGINT', () => child.kill('SIGINT'));
process.once('SIGTERM', () => child.kill('SIGTERM'));
const [code] = await once(child, 'exit');
process.exitCode = typeof code === 'number' ? code : 1;
