import { describe, expect, it } from 'vitest';
import { browserChildEnvironment } from '../src/browser-fixture';

describe('packed browser child environment', () => {
  it.each(['/workspace/.work/empty-browsers', './cache with spaces', '0'])(
    'uses the explicitly provisioned browser cache %s',
    (path) => {
      expect(
        browserChildEnvironment({ PATH: '/pinned/bin' }, { PLAYWRIGHT_BROWSERS_PATH: path })
      ).toEqual({ PATH: '/pinned/bin', PLAYWRIGHT_BROWSERS_PATH: path });
    }
  );
  it('keeps the normal browser lookup when no custom cache was configured', () => {
    expect(browserChildEnvironment({ HOME: '/task/home' }, {})).toEqual({ HOME: '/task/home' });
  });
  it('does not inherit translation credentials or reader secrets', () => {
    const inherited = {
      PLAYWRIGHT_BROWSERS_PATH: '/task/browsers',
      GT_API_KEY: 'synthetic-gt-secret',
      STRAPI_API_TOKEN: 'synthetic-reader-secret',
      UNRELATED: 'ignored',
    };
    const result = browserChildEnvironment({ ADMIN_URL: 'http://127.0.0.1:1337' }, inherited);
    expect(result).not.toHaveProperty('GT_API_KEY');
    expect(result).not.toHaveProperty('STRAPI_API_TOKEN');
    expect(result).not.toHaveProperty('UNRELATED');
    expect(result.ADMIN_URL).toBe('http://127.0.0.1:1337');
  });
  it('does not modify the reader environment or caller input', () => {
    const reader = { STRAPI_URL: 'http://127.0.0.1:1337' };
    browserChildEnvironment(reader, { PLAYWRIGHT_BROWSERS_PATH: '/task/browsers' });
    expect(reader).toEqual({ STRAPI_URL: 'http://127.0.0.1:1337' });
  });
});
