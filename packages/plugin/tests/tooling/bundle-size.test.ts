import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { measureBundle } from '../../scripts/check-size.mjs';

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'gt-size-'));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('admin size budget', () => {
  it('measures every emitted chunk', async () => {
    const first = join(directory, 'first.mjs');
    const second = join(directory, 'second.mjs');
    await writeFile(first, 'a'.repeat(100));
    await writeFile(second, 'b'.repeat(50));
    expect(await measureBundle([first, second], 150)).toEqual({
      bytes: 150,
      limitBytes: 150,
      passed: true,
    });
  });
  it('fails a bundle over its budget', async () => {
    const file = join(directory, 'large.mjs');
    await writeFile(file, 'a'.repeat(151));
    expect((await measureBundle([file], 150)).passed).toBe(false);
  });
  it('rejects an empty artifact selection', async () => {
    await expect(measureBundle([], 150)).rejects.toThrow();
  });
  it('rejects invalid budget values', async () => {
    await expect(measureBundle(['missing.mjs'], Number.NaN)).rejects.toThrow();
    await expect(measureBundle(['missing.mjs'], -1)).rejects.toThrow();
  });
  it('does not hide missing output files', async () => {
    await expect(measureBundle([join(directory, 'missing.mjs')], 150)).rejects.toThrow();
  });
});
