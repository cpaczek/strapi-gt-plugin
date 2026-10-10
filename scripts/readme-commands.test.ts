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
  const result = spawnSync(
    process.execPath,
    [resolve('scripts/check-readme.mjs'), filename, ...(runVersions ? ['--run-versions'] : [])],
    { encoding: 'utf8', cwd: directory }
  );
  if (result.error) throw result.error;
  return result;
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

describe('README command boundary cases', () => {
  it('accepts CRLF files and comments without treating comments as commands', async () => {
    const result = await check('```sh\r\n# Install first\r\n\r\nnode --version\r\n```');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).commands[0].line).toBe(4);
  });
  it('accepts tilde fences', async () => {
    const result = await check('~~~bash\npnpm --version\n~~~');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).commands).toHaveLength(1);
  });
  it('does not read a nested example inside a longer text fence', async () => {
    const result = await check('````text\n```sh\nnode --version\n```\n````');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).commands).toEqual([]);
  });
  it('accepts long ordinary package arguments without truncation', async () => {
    const argument = 'a'.repeat(10_000);
    const result = await check(`\`\`\`sh\npnpm ${argument}\n\`\`\``);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).commands[0].arguments[1]).toBe(argument);
  });
  it('ignores multilingual prose outside command fences', async () => {
    const result = await check('עברית 日本語\n```sh\nnode --version\n```\nالعربية');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).commands).toHaveLength(1);
  });
  it.each([
    'node --version; touch marker',
    'node --version && touch marker',
    'node --version | tee marker',
    'node --version > marker',
    'pnpm `touch marker`',
    'pnpm "$HOME"',
  ])('refuses shell syntax in %s', async (command) => {
    const result = await check(`\`\`\`sh\n${command}\n\`\`\``, true);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('line 2');
  });
  it('keeps two independent invocations isolated', async () => {
    const first = await check('```sh\nnode --version\n```');
    const second = await check('```json\n{}\n```');
    expect(JSON.parse(first.stdout).commands).toHaveLength(1);
    expect(JSON.parse(second.stdout).commands).toEqual([]);
  });
});
