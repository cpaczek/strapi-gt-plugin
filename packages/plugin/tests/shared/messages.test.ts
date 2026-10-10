import { describe, expect, it } from 'vitest';
import { buildMessage, formatUnknownError, messages } from '../../shared/messages';

describe('user-facing messages', () => {
  it('owns the prefix, sentence order and punctuation', () => {
    expect(buildMessage({ code: 'example', happened: 'The translation stopped.', why: 'The key expired', fix: 'Replace GT_API_KEY.', fallback: 'Keep editing the source', docs: 'https://generaltranslation.com/docs' }).text).toBe('General Translation: The translation stopped. The key expired. Replace GT_API_KEY. Keep editing the source. Documentation: https://generaltranslation.com/docs');
  });
  it('requires a useful description', () => {
    expect(() => buildMessage({ code: 'empty', happened: '  ' })).toThrow();
  });
  it('preserves questions and exclamations without extra punctuation', () => {
    expect(buildMessage({ code: 'punctuation', happened: 'Connection failed!', fix: 'Try again?' }).text).toBe('General Translation: Connection failed! Try again?');
  });
  it('redacts provider keys and bearer tokens', () => {
    expect(formatUnknownError(new Error('Denied gtx-org-testsecret123 Bearer confidential-token'))).not.toMatch(/testsecret123|confidential-token/);
  });
  it('redacts credential assignments and credential-bearing URLs', () => {
    const formatted = formatUnknownError('api_key=private-value https://user:password@example.com/?token=hidden-value');
    expect(formatted).not.toMatch(/private-value|password|hidden-value/);
  });
  it('does not inspect arbitrary object values', () => {
    expect(formatUnknownError({ apiKey: 'do-not-serialize', nested: { secret: 'sensitive' } })).not.toMatch(/do-not-serialize|sensitive/);
  });
  it('bounds arbitrary provider output', () => {
    expect(formatUnknownError('x'.repeat(20_000)).length).toBeLessThan(1_000);
  });
  it('does not invoke hostile error accessors', () => {
    const unknownFailure = Object.defineProperty({}, 'message', { get() { throw new Error('getter executed'); } });
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
