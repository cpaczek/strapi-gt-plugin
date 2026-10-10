import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { expect, it, vi } from 'vitest';

it('starts the built mock apps without development file watchers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gt-demo-launch-'));
  const executable = join(directory, 'pnpm');
  await writeFile(
    executable,
    `#!/usr/bin/env node
const { createServer } = require('node:http');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
const server = createServer();
server.listen(0, '127.0.0.1', () => {
  writeFileSync(join(process.env.DEMO_PROBE_DIR, process.pid + '.json'), JSON.stringify({ args: process.argv.slice(2), mode: process.env.NODE_ENV }));
});
process.once('SIGTERM', () => server.close());
`
  );
  await chmod(executable, 0o700);
  const runner = spawn(process.execPath, [resolve('scripts/testbed/demo.mjs')], {
    env: {
      ...process.env,
      PATH: `${directory}:${dirname(process.execPath)}:${process.env.PATH ?? ''}`,
      DEMO_PROBE_DIR: directory,
    },
    stdio: 'ignore',
  });
  const exited = once(runner, 'exit');
  try {
    await vi.waitFor(
      async () => {
        expect((await readdir(directory)).filter((name) => name.endsWith('.json'))).toHaveLength(3);
      },
      { timeout: 10_000 }
    );
    const records: unknown[] = await Promise.all(
      (await readdir(directory))
        .filter((name) => name.endsWith('.json'))
        .map(async (name) => JSON.parse(await readFile(join(directory, name), 'utf8')))
    );
    expect(records).toContainEqual({
      args: ['--filter', '@gt/playground', 'start'],
      mode: 'production',
    });
    expect(records).toContainEqual({
      args: ['--filter', '@gt/reader', 'start'],
      mode: 'production',
    });
  } finally {
    if (runner.exitCode === null) runner.kill('SIGTERM');
    await exited;
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);
