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
