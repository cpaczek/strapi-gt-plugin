import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { selectChangedFiles } from './format-changed.mjs';

let fixtureRoot: string;
let outsideRoot: string;
beforeEach(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), 'gt-format-'));
  outsideRoot = await mkdtemp(join(tmpdir(), 'gt-format-outside-'));
  await writeFile(join(fixtureRoot, 'entry.ts'), 'const count=1;\n');
  await writeFile(join(fixtureRoot, 'second.ts'), 'const count=2;\n');
});
afterEach(async () => {
  await rm(fixtureRoot, { recursive: true, force: true });
  await rm(outsideRoot, { recursive: true, force: true });
});

describe('edit hook path selection', () => {
  it('reads Edit and Write file_path inputs', () => {
    expect(selectChangedFiles({ tool_input: { file_path: 'entry.ts' } }, fixtureRoot)).toEqual([
      join(fixtureRoot, 'entry.ts'),
    ]);
  });
  it('reads apply_patch command paths', () => {
    expect(
      selectChangedFiles(
        {
          tool_input: { command: '*** Begin Patch\n*** Update File: entry.ts\n@@\n*** End Patch' },
        },
        fixtureRoot
      )
    ).toEqual([join(fixtureRoot, 'entry.ts')]);
  });
  it('reads added files', () => {
    expect(
      selectChangedFiles({ tool_input: { command: '*** Add File: entry.ts\n+line' } }, fixtureRoot)
    ).toHaveLength(1);
  });
  it('handles moved files at their new path', () => {
    expect(
      selectChangedFiles(
        { tool_input: { command: '*** Update File: gone.ts\n*** Move to: second.ts' } },
        fixtureRoot
      )
    ).toEqual([join(fixtureRoot, 'second.ts')]);
  });
  it('ignores deleted files', () => {
    expect(
      selectChangedFiles({ tool_input: { command: '*** Delete File: entry.ts' } }, fixtureRoot)
    ).toEqual([]);
  });
  it('deduplicates repeated edit paths', () => {
    expect(
      selectChangedFiles(
        { tool_input: { command: '*** Update File: entry.ts\n*** Update File: entry.ts' } },
        fixtureRoot
      )
    ).toHaveLength(1);
  });
  it('rejects parent traversal', () => {
    expect(selectChangedFiles({ tool_input: { file_path: '../outside.ts' } }, fixtureRoot)).toEqual(
      []
    );
  });
  it('rejects absolute paths outside the worktree', async () => {
    const foreign = join(outsideRoot, 'entry.ts');
    await writeFile(foreign, 'const count=1;');
    expect(selectChangedFiles({ tool_input: { file_path: foreign } }, fixtureRoot)).toEqual([]);
  });
  it('rejects symlinks that leave the worktree', async () => {
    const foreign = join(outsideRoot, 'entry.ts');
    await writeFile(foreign, 'const count=1;');
    await symlink(foreign, join(fixtureRoot, 'linked.ts'));
    expect(selectChangedFiles({ tool_input: { file_path: 'linked.ts' } }, fixtureRoot)).toEqual([]);
  });
  it('ignores generated dependency and working files', async () => {
    for (const directory of ['node_modules', 'dist', '.work', '.worktrees', '.git']) {
      await mkdir(join(fixtureRoot, directory));
      await writeFile(join(fixtureRoot, directory, 'entry.ts'), 'const count=1;');
      expect(
        selectChangedFiles({ tool_input: { file_path: `${directory}/entry.ts` } }, fixtureRoot)
      ).toEqual([]);
    }
  });
  it('does not format credential files', async () => {
    await writeFile(join(fixtureRoot, '.env'), 'EXAMPLE=value');
    expect(selectChangedFiles({ tool_input: { file_path: '.env' } }, fixtureRoot)).toEqual([]);
  });
  it('accepts names with spaces without shell parsing', async () => {
    await writeFile(join(fixtureRoot, 'entry with spaces.ts'), 'const count=1;');
    expect(
      selectChangedFiles({ tool_input: { file_path: 'entry with spaces.ts' } }, fixtureRoot)
    ).toHaveLength(1);
  });
  it('ignores unknown event shapes', () => {
    expect(selectChangedFiles({ tool_input: null }, fixtureRoot)).toEqual([]);
    expect(selectChangedFiles(null, fixtureRoot)).toEqual([]);
  });
  it('ignores absent files', () => {
    expect(selectChangedFiles({ tool_input: { file_path: 'missing.ts' } }, fixtureRoot)).toEqual(
      []
    );
  });
  it('accepts absolute paths within the worktree', () => {
    expect(
      selectChangedFiles({ tool_input: { file_path: join(fixtureRoot, 'entry.ts') } }, fixtureRoot)
    ).toHaveLength(1);
  });
});

describe('edit hook boundary cases', () => {
  it('rejects a symlink into an excluded generated directory', async () => {
    await mkdir(join(fixtureRoot, 'node_modules'));
    await writeFile(join(fixtureRoot, 'node_modules', 'generated.ts'), 'const value=1;');
    await symlink(join(fixtureRoot, 'node_modules', 'generated.ts'), join(fixtureRoot, 'alias.ts'));
    expect(selectChangedFiles({ tool_input: { file_path: 'alias.ts' } }, fixtureRoot)).toEqual([]);
  });
  it('accepts a symlink to an ordinary source file in the same worktree', async () => {
    await symlink(join(fixtureRoot, 'entry.ts'), join(fixtureRoot, 'alias.ts'));
    expect(selectChangedFiles({ tool_input: { file_path: 'alias.ts' } }, fixtureRoot)).toHaveLength(
      1
    );
  });
  it('rejects directories even with a supported suffix', async () => {
    await mkdir(join(fixtureRoot, 'directory.ts'));
    expect(selectChangedFiles({ tool_input: { file_path: 'directory.ts' } }, fixtureRoot)).toEqual(
      []
    );
  });
  it('does not format nested credential snapshots', async () => {
    await writeFile(join(fixtureRoot, '.env.backup.json'), '{}');
    expect(
      selectChangedFiles({ tool_input: { file_path: '.env.backup.json' } }, fixtureRoot)
    ).toEqual([]);
  });
  it('treats shell punctuation as an ordinary filename', async () => {
    const filename = 'entry;$(echo example).ts';
    await writeFile(join(fixtureRoot, filename), 'const count=1;');
    expect(selectChangedFiles({ tool_input: { file_path: filename } }, fixtureRoot)).toEqual([
      join(fixtureRoot, filename),
    ]);
  });
  it('handles several different files in one patch', () => {
    expect(
      selectChangedFiles(
        { tool_input: { command: '*** Update File: entry.ts\n*** Add File: second.ts' } },
        fixtureRoot
      )
    ).toHaveLength(2);
  });
  it('deduplicates absolute and relative spellings', () => {
    expect(
      selectChangedFiles(
        {
          tool_input: {
            file_path: join(fixtureRoot, 'entry.ts'),
            command: '*** Update File: entry.ts',
          },
        },
        fixtureRoot
      )
    ).toHaveLength(1);
  });
  it('ignores nonstring input fields', () => {
    expect(selectChangedFiles({ tool_input: { file_path: 12, command: [] } }, fixtureRoot)).toEqual(
      []
    );
  });
  it('ignores binary formats', async () => {
    await writeFile(join(fixtureRoot, 'photo.png'), Buffer.from([0, 1, 2]));
    expect(selectChangedFiles({ tool_input: { file_path: 'photo.png' } }, fixtureRoot)).toEqual([]);
  });
  it('does not read another event field as a file path', () => {
    expect(selectChangedFiles({ tool_response: { file_path: 'entry.ts' } }, fixtureRoot)).toEqual(
      []
    );
  });
});
