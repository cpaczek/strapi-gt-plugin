import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/constants';
import type { SettingsMetadata } from '../../server/src/settings';
import { validateSettings, publicSettings } from '../../server/src/settings';

const metadata: SettingsMetadata = {
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

it('uses the schema UID source field when regeneration has no explicit override', () => {
  const configured = {
    ...settings,
    contentTypes: {
      'api::article.article': {
        fields: { slug: { translate: true, uidStrategy: 'regenerate' } },
        mediaMetadata: false,
      },
    },
  };
  const available: SettingsMetadata = {
    ...metadata,
    contentTypes: [
      {
        ...metadata.contentTypes[0]!,
        attributes: {
          ...metadata.contentTypes[0]!.attributes,
          slug: { type: 'uid', localized: true, targetField: 'title' },
        },
      },
    ],
  };
  expect(() => validateSettings(configured, available)).not.toThrow();
});
it('rejects a nested field hidden by a private component', () => {
  const available: SettingsMetadata = {
    ...metadata,
    contentTypes: [
      {
        ...metadata.contentTypes[0]!,
        attributes: {
          panel: { type: 'component', localized: true, private: true, component: 'shared.panel' },
        },
      },
    ],
    components: {
      'shared.panel': {
        uid: 'shared.panel',
        localized: true,
        draftAndPublish: false,
        attributes: { title: { type: 'string' } },
      },
    },
  };
  expect(() =>
    validateSettings(
      {
        ...settings,
        contentTypes: {
          'api::article.article': {
            fields: { 'panel.title': { translate: true } },
            mediaMetadata: false,
          },
        },
      },
      available
    )
  ).toThrow();
});
