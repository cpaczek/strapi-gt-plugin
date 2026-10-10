import { describe, expect, it } from 'vitest';
import { checkDefaultLiterals } from './check-defaults.mjs';
import { checkProse } from './check-prose.mjs';

describe('canonical defaults check', () => {
  const canonical = { REQUEST_TIMEOUT_MS: 30_000, GT_BASE_URL: 'https://api.gtx.dev' };
  it('rejects a repeated number independent of separator spelling', () => {
    expect(checkDefaultLiterals('const timeout = 30000;', canonical, 'request.ts')).toHaveLength(1);
  });
  it('rejects repeated base URLs', () => {
    expect(checkDefaultLiterals("const endpoint = 'https://api.gtx.dev';", canonical, 'request.ts')).toHaveLength(1);
  });
  it('allows importing canonical names', () => {
    expect(checkDefaultLiterals('const timeout = REQUEST_TIMEOUT_MS;', canonical, 'request.ts')).toEqual([]);
  });
  it('does not mistake prose comments or longer literals for defaults', () => {
    expect(checkDefaultLiterals('// 30000\nconst count = 300001;', canonical, 'request.ts')).toEqual([]);
  });
  it('checks values inside template literals', () => {
    expect(checkDefaultLiterals('const endpoint = `https://api.gtx.dev`;', canonical, 'request.ts')).toHaveLength(1);
  });
  it('does not allow a whole source file by filename alone', () => {
    expect(checkDefaultLiterals('const timeout = 30000;', canonical, 'my-test-helper.ts')).toHaveLength(1);
  });
});

describe('prose policy', () => {
  it('rejects required punctuation controls', () => {
    expect(checkProse('Use this \u2014 or that \u2013 with \u201ccurly\u201d quotes.', 'README.md').length).toBeGreaterThanOrEqual(4);
  });
  it('rejects prohibited phrases case-insensitively', () => {
    expect(checkProse('A ROBUST solution lets you dive in.', 'README.md')).toHaveLength(2);
  });
  it('rejects the paired contrast phrase', () => {
    expect(checkProse('Not only quick but also useful.', 'README.md')).toHaveLength(1);
  });
  it('allows ordinary words containing a listed word', () => {
    expect(checkProse('The harnessed fixture is in tests.', 'README.md')).toEqual([]);
  });
  it('checks code comments and user-facing string literals', () => {
    expect(checkProse("// A robust service\nconst label = 'Unlock translations';", 'screen.ts')).toHaveLength(2);
  });
  it('does not lint identifier spellings', () => {
    expect(checkProse('const streamline = 1;', 'screen.ts')).toEqual([]);
  });
  it('finds emoji in headings', () => {
    expect(checkProse('# Install \u{1F680}', 'README.md')).toHaveLength(1);
  });
  it('allows Unicode needed by translated text', () => {
    expect(checkProse('Bonjour. مرحبا. 日本語。', 'README.md')).toEqual([]);
  });
  it('rejects unallowlisted fixtures', () => {
    expect(checkProse('A robust output.', 'product-fixture.md')).toHaveLength(1);
  });
});
