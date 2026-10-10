import { describe, expect, it } from 'vitest';
import { buildMessage, formatUnknownError, messages } from '../../shared/messages';

describe('user-facing messages', () => {
  it('owns the prefix, sentence order and punctuation', () => {
    expect(
      buildMessage({
        code: 'example',
        happened: 'The translation stopped.',
        why: 'The key expired',
        fix: 'Replace GT_API_KEY.',
        fallback: 'Keep editing the source',
        docs: 'https://generaltranslation.com/docs',
      }).text
    ).toBe(
      'General Translation: The translation stopped. The key expired. Replace GT_API_KEY. Keep editing the source. Documentation: https://generaltranslation.com/docs'
    );
  });
  it('requires a useful description', () => {
    expect(() => buildMessage({ code: 'empty', happened: '  ' })).toThrow();
  });
  it('preserves questions and exclamations without extra punctuation', () => {
    expect(
      buildMessage({ code: 'punctuation', happened: 'Connection failed!', fix: 'Try again?' }).text
    ).toBe('General Translation: Connection failed! Try again?');
  });
  it('redacts provider keys and bearer tokens', () => {
    expect(
      formatUnknownError(new Error('Denied gtx-org-testsecret123 Bearer confidential-token'))
    ).not.toMatch(/testsecret123|confidential-token/);
  });
  it('redacts credential assignments and credential-bearing URLs', () => {
    const formatted = formatUnknownError(
      'api_key=private-value https://user:password@example.com/?token=hidden-value'
    );
    expect(formatted).not.toMatch(/private-value|password|hidden-value/);
  });
  it('does not inspect arbitrary object values', () => {
    expect(
      formatUnknownError({ apiKey: 'do-not-serialize', nested: { secret: 'sensitive' } })
    ).not.toMatch(/do-not-serialize|sensitive/);
  });
  it('bounds arbitrary provider output', () => {
    expect(formatUnknownError('x'.repeat(20_000)).length).toBeLessThan(1_000);
  });
  it('does not invoke hostile error accessors', () => {
    const unknownFailure = Object.defineProperty({}, 'message', {
      get() {
        throw new Error('getter executed');
      },
    });
    expect(() => formatUnknownError(unknownFailure)).not.toThrow();
  });
  it('offers a remedy for invalid credentials', () => {
    const message = messages.invalidKey();
    expect(message.code).toBe('invalid-key');
    expect(message.text).toContain('GT_API_KEY');
    expect(message.text).not.toContain('undefined');
  });
  it('keeps values separate from message source wording', () => {
    const message = messages.unsupportedLocale('xx-ZZ');
    expect(message.details).toEqual({ locale: 'xx-ZZ' });
    expect(message.text).toContain('xx-ZZ');
  });
  it('uses the same transportable object for logs and notifications', () => {
    const message = messages.networkFailure(new Error('connection reset'));
    expect(JSON.parse(JSON.stringify(message))).toEqual(message);
    expect(message.text).toContain('connection reset');
  });
});

describe('diagnostic edge cases', () => {
  it('formats null without serializing it', () => {
    expect(formatUnknownError(null)).toContain('safe error description');
  });
  it('formats a circular object safely', () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect(() => formatUnknownError(circular)).not.toThrow();
  });
  it('does not invoke custom string conversion', () => {
    expect(
      formatUnknownError({
        toString() {
          throw new Error('unsafe');
        },
      })
    ).toContain('safe error description');
  });
  it('handles hostile property-descriptor traps', () => {
    const failure = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new Error('unsafe');
        },
      }
    );
    expect(() => formatUnknownError(failure)).not.toThrow();
  });
  it('handles a revoked proxy', () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    expect(() => formatUnknownError(proxy)).not.toThrow();
  });
  it('removes terminal control characters', () => {
    // This fixture verifies that terminal controls are removed.
    // oxlint-disable-next-line no-control-regex
    expect(formatUnknownError('bad\u0000\u001b[31m\nvalue')).not.toMatch(/[\u0000\u001b\n]/);
  });
  it('redacts all repeated credentials', () => {
    expect(formatUnknownError('gtx-secret-one gtx-secret-two')).toBe('[redacted] [redacted]');
  });
  it('preserves useful nonsecret diagnostics', () => {
    expect(formatUnknownError(new Error('Connection refused'))).toBe('Connection refused');
  });
  it('sanitizes structured variable values', () => {
    expect(
      buildMessage({
        code: 'failure',
        happened: 'Request failed',
        details: { reason: 'token=private' },
      }).text
    ).not.toContain('private');
  });
  it('omits empty optional clauses', () => {
    expect(
      buildMessage({ code: 'failure', happened: 'Request failed', why: '', fix: ' ' }).text
    ).toBe('General Translation: Request failed.');
  });
  it('preserves Arabic text in details', () => {
    expect(messages.unsupportedLocale('العربية').details.locale).toBe('العربية');
  });
  it('provides billing and permission remedies without provider payloads', () => {
    expect(messages.quotaExhausted().text).toContain('billing');
    expect(messages.permissionDenied().text).toContain('administrator');
  });
});
