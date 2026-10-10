import { describe, expect, it } from 'vitest';
import { localeLabel } from '../../admin/src/i18n';

describe('Strapi locale display labels', () => {
  it('adds the code when Strapi supplies only the language name', () => {
    expect(localeLabel({ name: 'French', code: 'fr' })).toBe('French (fr)');
  });
  it('keeps the code once when Strapi already includes it', () => {
    expect(localeLabel({ name: 'French (fr)', code: 'fr' })).toBe('French (fr)');
  });
  it('preserves an explicit script and region', () => {
    expect(localeLabel({ name: 'Chinese', code: 'zh-Hant-TW' })).toBe('Chinese (zh-Hant-TW)');
  });
  it('preserves RTL names with an existing locale suffix', () => {
    expect(localeLabel({ name: 'العربية (ar)', code: 'ar' })).toBe('العربية (ar)');
  });
});
