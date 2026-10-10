import { createIntl, createIntlCache } from 'react-intl';
import { describe, expect, it, vi } from 'vitest';
import plugin from '../../admin/src';
import english from '../../admin/src/translations/en.json';
import { PLUGIN_ID } from '../../shared/constants';

vi.mock('@strapi/icons', () => ({ Earth: () => null }));
vi.mock('../../admin/src/extensions', () => ({
  TranslateAction: () => null,
  TranslateBulkAction: () => null,
  TranslationPanel: () => null,
}));

const variables = (message: string) =>
  [...new Set([...message.matchAll(/\{([A-Za-z]+)(?:[,}])/g)].map((match) => match[1]))].sort();

describe('admin interface locales', () => {
  it.each(['es', 'fr', 'ar'])('loads the complete GT-generated %s interface', async (locale) => {
    const [translation] = await plugin.registerTrads({ locales: [locale] });
    expect(translation?.locale).toBe(locale);
    expect(translation?.data[`${PLUGIN_ID}.settings.save`]).not.toBe(english['settings.save']);
    expect(Object.keys(translation?.data ?? {}).sort()).toEqual(
      Object.keys(english)
        .map((key) => `${PLUGIN_ID}.${key}`)
        .sort()
    );
    for (const [key, source] of Object.entries(english)) {
      const translated = translation?.data[`${PLUGIN_ID}.${key}`] ?? '';
      expect(translated.trim(), key).not.toBe('');
      expect(variables(translated), key).toEqual(variables(source));
    }
  });
  it.each(['es-MX', 'fr-CA', 'ar-SA'])('reuses its language dictionary for %s', async (locale) => {
    const [regional, language] = await plugin.registerTrads({
      locales: [locale, locale.split('-')[0] ?? locale],
    });
    expect(regional?.data).toEqual(language?.data);
    expect(regional?.data[`${PLUGIN_ID}.settings.save`]).not.toBe(english['settings.save']);
  });
  it.each(['en', 'en-US', 'zz'])('keeps the English fallback for %s', async (locale) => {
    const [translation] = await plugin.registerTrads({ locales: [locale] });
    expect(translation?.data[`${PLUGIN_ID}.settings.save`]).toBe(english['settings.save']);
  });
  it.each(['constructor', '__proto__', 'toString', ''])(
    'safely falls back for an unknown locale %s',
    async (locale) => {
      const [translation] = await plugin.registerTrads({ locales: [locale] });
      expect(translation?.data[`${PLUGIN_ID}.settings.save`]).toBe(english['settings.save']);
    }
  );
  it('uses Arabic plural forms for zero, one, two, few, many and other', async () => {
    const [translation] = await plugin.registerTrads({ locales: ['ar'] });
    for (const key of ['translation.count', 'jobs.total']) {
      for (const category of ['zero', 'one', 'two', 'few', 'many', 'other'])
        expect(translation?.data[`${PLUGIN_ID}.${key}`]).toMatch(
          new RegExp(`\\b${category}\\s*\\{`)
        );
    }
  });
  it.each(['es', 'fr', 'ar'])(
    'renders ICU messages and interpolated values in %s',
    async (locale) => {
      const [translation] = await plugin.registerTrads({ locales: [locale] });
      const intl = createIntl(
        {
          locale,
          messages: translation?.data,
          onError: (failure) => {
            throw failure;
          },
        },
        createIntlCache()
      );
      for (const count of [0, 1, 2, 3, 11, 100]) {
        for (const key of Object.keys(english)) {
          expect(
            intl.formatMessage(
              { id: `${PLUGIN_ID}.${key}` },
              {
                count,
                locale: 'es',
                path: 'title',
                model: 'Article',
                id: 42,
                stage: 'translate',
                page: 2,
                property: 'caption',
                value: 'Value',
                name: 'Demo',
                locales: 'es, fr, ar',
              }
            )
          ).not.toBe(`${PLUGIN_ID}.${key}`);
        }
      }
    }
  );
});
