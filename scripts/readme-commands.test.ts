import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let directory: string;
let filename: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'gt-readme-'));
  filename = join(directory, 'README.md');
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
const check = async (markdown: string, runVersions = false) => {
  await writeFile(filename, markdown);
  return spawnSync(
    process.execPath,
    [resolve('scripts/check-readme.mjs'), filename, ...(runVersions ? ['--run-versions'] : [])],
    { encoding: 'utf8', cwd: directory }
  );
};

describe('README shell command extraction', () => {
  it('extracts every shell block in order and records source lines', async () => {
    const result = await check('```sh\nnode --version\n```\ntext\n```bash\npnpm --version\n```');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      commands: [
        { line: 2, command: 'node --version', arguments: ['node', '--version'] },
        { line: 6, command: 'pnpm --version', arguments: ['pnpm', '--version'] },
      ],
      executedVersionChecks: [],
    });
  });
  it('runs explicit read-only version checks from extracted commands', async () => {
    const result = await check('```shell\nnode --version\n```', true);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).executedVersionChecks).toEqual([
      { command: 'node --version', output: process.version },
    ]);
  });
  it('leaves install and project scripts unexecuted during validation', async () => {
    const result = await check('```sh\npnpm install --frozen-lockfile\npnpm build\n```', true);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).executedVersionChecks).toEqual([]);
  });
  it('ignores non-shell examples', async () => {
    const result = await check('```json\n{"command":"node --version"}\n```');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).commands).toEqual([]);
  });
  it('refuses shell expansion before executing any version check', async () => {
    const result = await check('```sh\nnode --version\npnpm $(touch marker)\n```', true);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('line 3');
  });
  it('rejects an unterminated shell block', async () => {
    const result = await check('```sh\nnode --version');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Unclosed');
  });
});
