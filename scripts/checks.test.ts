import { describe, expect, it } from 'vitest';
import { checkDefaultLiterals } from './check-defaults.mjs';
import { checkProse } from './check-prose.mjs';

describe('canonical defaults check', () => {
  const canonical = { REQUEST_TIMEOUT_MS: 30_000, GT_BASE_URL: 'https://api.gtx.dev' };
  it('rejects a repeated number independent of separator spelling', () => {
    expect(checkDefaultLiterals('const timeout = 30000;', canonical, 'request.ts')).toHaveLength(1);
  });
  it('rejects repeated base URLs', () => {
    expect(
      checkDefaultLiterals("const endpoint = 'https://api.gtx.dev';", canonical, 'request.ts')
    ).toHaveLength(1);
  });
  it('allows importing canonical names', () => {
    expect(
      checkDefaultLiterals('const timeout = REQUEST_TIMEOUT_MS;', canonical, 'request.ts')
    ).toEqual([]);
  });
  it('does not mistake prose comments or longer literals for defaults', () => {
    expect(
      checkDefaultLiterals('// 30000\nconst count = 300001;', canonical, 'request.ts')
    ).toEqual([]);
  });
  it('checks values inside template literals', () => {
    expect(
      checkDefaultLiterals('const endpoint = `https://api.gtx.dev`;', canonical, 'request.ts')
    ).toHaveLength(1);
  });
  it('does not allow a whole source file by filename alone', () => {
    expect(
      checkDefaultLiterals('const timeout = 30000;', canonical, 'my-test-helper.ts')
    ).toHaveLength(1);
  });
});

describe('prose policy', () => {
  it('rejects required punctuation controls', () => {
    expect(
      checkProse('Use this \u2014 or that \u2013 with \u201ccurly\u201d quotes.', 'README.md')
        .length
    ).toBeGreaterThanOrEqual(4);
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
    expect(
      checkProse("// A robust service\nconst label = 'Unlock translations';", 'screen.ts')
    ).toHaveLength(2);
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

describe('defaults edge cases', () => {
  const canonical = { TIMEOUT: 30_000, ENDPOINT: 'https://api.gtx.dev' };
  it('recognizes hexadecimal numeric spelling', () => {
    expect(checkDefaultLiterals('const timeout = 0x7530;', canonical, 'hex.ts')).toHaveLength(1);
  });
  it('recognizes escaped URL spelling', () => {
    expect(
      checkDefaultLiterals(
        "const endpoint = 'https:\\u002f\\u002fapi.gtx.dev';",
        canonical,
        'escaped.ts'
      )
    ).toHaveLength(1);
  });
  it('allows a different signed value', () => {
    expect(checkDefaultLiterals('const offset = -30000;', canonical, 'signed.ts')).toEqual([]);
  });
  it('allows literal contract types', () => {
    expect(checkDefaultLiterals('type Allowed = 30000;', canonical, 'types.ts')).toEqual([]);
  });
  it('checks a value inside a nested object', () => {
    expect(
      checkDefaultLiterals(
        'const config = { request: { timeout: 30000 } };',
        canonical,
        'nested.ts'
      )
    ).toHaveLength(1);
  });
  it('checks JSX attribute expressions', () => {
    expect(
      checkDefaultLiterals('const field = <Input delay={30000} />;', canonical, 'field.tsx')
    ).toHaveLength(1);
  });
  it('ignores a regex pattern', () => {
    expect(checkDefaultLiterals('const pattern = /30000/;', canonical, 'regex.ts')).toEqual([]);
  });
  it('rejects invalid syntax instead of reporting a clean file', () => {
    expect(() => checkDefaultLiterals('const = ;', canonical, 'broken.ts')).toThrow();
  });
  it('reports distinct duplicated values separately', () => {
    expect(
      checkDefaultLiterals("const config = [30000, 'https://api.gtx.dev'];", canonical, 'both.ts')
    ).toHaveLength(2);
  });
  it('allows bigint values with different semantics', () => {
    expect(checkDefaultLiterals('const large = 30000n;', canonical, 'bigint.ts')).toEqual([]);
  });
});

describe('prose edge cases', () => {
  it('checks JSX text', () => {
    expect(checkProse('const panel = <p>A robust setup.</p>;', 'panel.tsx')).toHaveLength(1);
  });
  it('checks escaped punctuation in UI strings', () => {
    expect(checkProse("const label = 'Go \\u2014 now';", 'label.ts')).toHaveLength(1);
  });
  it('checks template fragments', () => {
    expect(checkProse('const label = `A robust ${name}`;', 'label.ts')).toHaveLength(1);
  });
  it('checks paired contrast across template substitutions', () => {
    expect(
      checkProse('const label = `Not only ${first} but also ${second}`;', 'label.ts')
    ).toHaveLength(1);
  });
  it('checks slightly indented markdown headings', () => {
    expect(checkProse('  ## Install \u{1F680}', 'README.md')).toHaveLength(1);
  });
  it('does not ban emoji in an ordinary quoted example', () => {
    expect(checkProse('An example icon is \u{1F680}.', 'README.md')).toEqual([]);
  });
  it('does not treat code regex syntax as prose', () => {
    expect(checkProse('const pattern = /robust/;', 'pattern.ts')).toEqual([]);
  });
  it('checks adjacent prohibited phrases independently', () => {
    expect(checkProse('Moreover, seamless and effortless.', 'README.md')).toHaveLength(3);
  });
  it('keeps apostrophes in the phrase matcher', () => {
    expect(checkProse("In today's example, use a file.", 'README.md')).toHaveLength(1);
  });
  it('fails on malformed code instead of dropping its strings', () => {
    expect(() => checkProse("const = 'robust';", 'broken.ts')).toThrow();
  });
});
