import { describe, expect, it } from 'vitest';
import { declaredBinary } from '../../../../scripts/testbed/package-bin.mjs';

describe('public package CLI declarations', () => {
  it('accepts a string bin declaration', () => {
    expect(declaredBinary({ bin: './bin/strapi.js' }, 'strapi')).toBe('./bin/strapi.js');
  });
  it('accepts a named bin declaration', () => {
    expect(declaredBinary({ bin: { vitest: './vitest.mjs' } }, 'vitest')).toBe('./vitest.mjs');
  });
  it('rejects a missing named binary', () => {
    expect(() => declaredBinary({ bin: { other: './other.js' } }, 'strapi')).toThrow();
  });
  it('rejects a non-string binary', () => {
    expect(() => declaredBinary({ bin: 17 }, 'strapi')).toThrow();
  });
});
