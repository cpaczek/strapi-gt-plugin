import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/constants';
import { validateSettings, publicSettings } from '../../server/src/settings';

const metadata = {
  locales: [
    { code: 'en', name: 'English' },
    { code: 'fr', name: 'French' },
  ],
  contentTypes: [
    {
      uid: 'api::article.article',
      localized: true,
      draftAndPublish: true,
      attributes: {
        title: { type: 'string', localized: true },
        secret: { type: 'password', private: true },
      },
    },
  ],
  components: {},
  supportedLocales: ['en', 'fr'],
  aiTranslationsEnabled: false,
};
const settings = {
  ...DEFAULT_SETTINGS,
  projectId: 'project',
  targetLocales: ['fr'],
  contentTypes: {
    'api::article.article': { fields: { title: { translate: true } }, mediaMetadata: false },
  },
};

describe('saved settings', () => {
  it('accepts explicit eligible fields and installed target locales', () => {
    expect(validateSettings(settings, metadata)).toEqual(settings);
  });
  it('rejects browser-supplied credentials instead of storing them', () => {
    expect(() => validateSettings({ ...settings, apiKey: 'sensitive' }, metadata)).toThrow();
  });
  it('rejects private field configuration', () => {
    expect(() =>
      validateSettings(
        {
          ...settings,
          contentTypes: {
            'api::article.article': {
              fields: { secret: { translate: true } },
              mediaMetadata: false,
            },
          },
        },
        metadata
      )
    ).toThrow();
  });
  it('masks key presence without retaining any part of a key', () => {
    const response = publicSettings(settings, metadata, 'secret-value');
    expect(response.hasApiKey).toBe(true);
    expect(response.maskedApiKey).toBe('********');
    expect(JSON.stringify(response)).not.toContain('secret-value');
  });
  it('rejects overlapping source and targets', () => {
    expect(() => validateSettings({ ...settings, targetLocales: ['en'] }, metadata)).toThrow();
  });
  it('rejects enabling automatic writers alongside built-in AI', () => {
    expect(() =>
      validateSettings(
        { ...settings, automaticMode: 'save' },
        { ...metadata, aiTranslationsEnabled: true }
      )
    ).toThrow();
  });
});
