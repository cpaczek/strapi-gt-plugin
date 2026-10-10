import { describe, expect, it } from 'vitest';
import { formatEnderLedger } from '../lib/formatting';

const input = {
  locale: 'en-US',
  amount: 1234.5,
  currency: 'USD',
  blocks: 1,
  mood: 'calm',
  cutoff: 24,
};
describe('GT formatting playground', () => {
  it('formats currency without changing the amount or claiming conversion', () => {
    expect(formatEnderLedger(input).currency).toBe('$1,234.50');
    expect(formatEnderLedger({ ...input, currency: 'EUR' }).currency).toBe('€1,234.50');
  });
  it('uses real plural and select branches', () => {
    expect(formatEnderLedger(input).message).toContain('1 block');
    expect(formatEnderLedger({ ...input, blocks: 2 }).message).toContain('2 blocks');
    expect(formatEnderLedger({ ...input, mood: 'furious' }).message).toContain('stare crime');
  });
  it('changes separators with the locale', () => {
    expect(formatEnderLedger({ ...input, locale: 'fr-FR' }).number).not.toBe(
      formatEnderLedger(input).number
    );
  });
  it('uses a fixed clock and explicit UTC for deterministic dates', () => {
    expect(formatEnderLedger(input).relative).toBe('yesterday');
    expect(formatEnderLedger(input).relativeFromDate).toBe('2 hours ago');
    expect(formatEnderLedger(input).date).toContain('2026');
  });
  it('supports Arabic layout metadata and localized output', () => {
    expect(formatEnderLedger({ ...input, locale: 'ar' }).direction).toBe('rtl');
  });
  it('keeps list objects intact for styled rich output', () => {
    const result = formatEnderLedger(input);
    expect(result.listParts.some((part) => typeof part === 'object' && part.label === 'dirt')).toBe(
      true
    );
    expect(result.list).toContain('dirt');
  });
  it('applies the requested text cutoff and preserves a zero limit', () => {
    expect(formatEnderLedger(input).cutoff.length).toBeLessThanOrEqual(24);
    expect(formatEnderLedger({ ...input, cutoff: 0 }).cutoff).toBe('');
  });
});

describe('formatting boundary cases', () => {
  it('uses the zero-count message instead of the singular branch', () => {
    expect(formatEnderLedger({ ...input, blocks: 0 }).message).toContain('No blocks');
  });
  it('formats a large block count inside the ICU message', () => {
    expect(formatEnderLedger({ ...input, blocks: 1000 }).message).toContain('1,000 blocks');
  });
  it('takes the select fallback for an unknown mood', () => {
    expect(formatEnderLedger({ ...input, mood: 'mysterious' }).message).toContain(
      'declines to comment'
    );
  });
  it('uses the currency minor units for yen', () => {
    expect(formatEnderLedger({ ...input, currency: 'JPY' }).currency).toBe('¥1,235');
  });
  it('formats a negative ledger entry without losing its sign', () => {
    expect(formatEnderLedger({ ...input, amount: -12.5 }).currency).toBe('-$12.50');
  });
  it('formats zero money as zero money', () => {
    expect(formatEnderLedger({ ...input, amount: 0 }).currency).toBe('$0.00');
  });
  it('changes the displayed hearing time when timezone changes', () => {
    expect(formatEnderLedger({ ...input, timeZone: 'Asia/Tokyo' }).date).not.toBe(
      formatEnderLedger(input).date
    );
  });
  it('keeps left-to-right output explicit for English', () => {
    expect(formatEnderLedger(input).direction).toBe('ltr');
  });
  it('provides a native locale name for the language inspector', () => {
    expect(formatEnderLedger({ ...input, locale: 'fr' }).localeProperties.nativeName).toContain(
      'français'
    );
  });
  it('leaves short text intact when the cutoff exceeds its length', () => {
    expect(formatEnderLedger({ ...input, cutoff: 1000 }).cutoff).toBe(
      'I would like to make a short statement about the alleged block yoink.'
    );
  });
  it('provides locale-specific list separators without translating item names', () => {
    const result = formatEnderLedger({ ...input, locale: 'fr' });
    expect(result.list).toContain(' et ');
    expect(result.list).toContain('dirt');
  });
  it('provides a visible error for an invalid programmer-supplied currency code', () => {
    expect(() => formatEnderLedger({ ...input, currency: 'not-a-code' })).toThrow();
  });
});
