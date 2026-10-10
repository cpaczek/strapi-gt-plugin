import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadBrowserAccount, loopbackOrigin } from '../src/browser-fixture';

describe('external consumer browser fixtures', () => {
  it.each(['http://127.0.0.1:1347', 'http://localhost:3147'])('accepts owned origin %s', (url) => {
    expect(loopbackOrigin(url)).toBe(url);
  });
  it.each([
    'https://127.0.0.1:1347',
    'http://example.com',
    'http://127.0.0.1.example.com',
    'http://editor:example@127.0.0.1:1347',
    'http://127.0.0.1:1347/admin',
    'http://127.0.0.1:1347?token=value',
    'http://127.0.0.1:1347#token',
  ])('rejects an unsafe fixture origin %s', (url) => {
    expect(() => loopbackOrigin(url)).toThrow();
  });
  it('reads only generated browser credentials from a selected consumer fixture', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gt-browser-fixture-'));
    const path = join(directory, 'account.json');
    const password = randomBytes(24).toString('hex');
    try {
      await writeFile(
        path,
        JSON.stringify({
          adminEmail: 'fixture@example.invalid',
          adminPassword: password,
          unrelated: 'not returned',
        }),
        { mode: 0o600 }
      );
      expect(await loadBrowserAccount(path)).toEqual({
        email: 'fixture@example.invalid',
        password,
      });
    } finally {
      await rm(directory, { recursive: true });
    }
  });
  it('rejects incomplete credentials instead of falling back to another account', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gt-browser-fixture-'));
    const path = join(directory, 'account.json');
    try {
      await writeFile(path, JSON.stringify({ adminEmail: 'fixture@example.invalid' }), {
        mode: 0o600,
      });
      await expect(loadBrowserAccount(path)).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true });
    }
  });
});
