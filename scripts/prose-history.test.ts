import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCommitMessages } from './check-prose.mjs';

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'gt-history-'));
  execFileSync('git', ['init', '--initial-branch=main', directory]);
  for (const message of ['chore: initialize fixture', 'feat: add locale display']) {
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.invalid',
        '-c',
        'core.hooksPath=/dev/null',
        'commit',
        '--allow-empty',
        '-m',
        message,
      ],
      { cwd: directory }
    );
  }
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('commit prose input', () => {
  it('reads commit bodies from the requested history', () => {
    expect(readCommitMessages('HEAD', directory)).toEqual([
      'feat: add locale display',
      'chore: initialize fixture',
    ]);
  });
  it('limits the check to a selected range', () => {
    expect(readCommitMessages('HEAD~1..HEAD', directory)).toEqual(['feat: add locale display']);
  });
  it('rejects Git option injection', () => {
    expect(() => readCommitMessages('--all', directory)).toThrow();
  });
  it('does not hide a missing revision', () => {
    expect(() => readCommitMessages('missing-ref', directory)).toThrow();
  });
});
