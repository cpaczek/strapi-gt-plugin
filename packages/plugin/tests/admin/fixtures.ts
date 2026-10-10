import { DEFAULT_SETTINGS } from '../../shared/constants';
import type {
  SettingsResponse,
  TranslationOptionsResponse,
  JobSummary,
} from '../../shared/contracts';

export const settingsResponse: SettingsResponse = {
  settings: {
    ...DEFAULT_SETTINGS,
    projectId: 'editorial',
    targetLocales: ['fr', 'ar'],
    createMissingLocales: true,
  },
  hasApiKey: true,
  maskedApiKey: '********',
  locales: [
    { code: 'en', name: 'English' },
    { code: 'fr', name: 'French' },
    { code: 'ar', name: 'Arabic' },
  ],
  supportedLocales: ['en', 'fr', 'ar'],
  contentTypes: [
    {
      uid: 'api::article.article',
      localized: true,
      draftAndPublish: true,
      attributes: {
        title: { type: 'string', localized: true },
        body: { type: 'richtext', localized: true },
        slug: { type: 'uid', targetField: 'title' },
        cover: { type: 'media', localized: true },
        section: { type: 'component', component: 'content.section', localized: true },
        secret: { type: 'string', private: true, localized: true },
        count: { type: 'integer' },
      },
    },
  ],
  components: {
    'content.section': {
      uid: 'content.section',
      localized: true,
      draftAndPublish: false,
      attributes: { heading: { type: 'string' } },
    },
  },
  aiTranslationsEnabled: false,
};
export const options: TranslationOptionsResponse = {
  configured: true,
  sourceLocale: 'en',
  targetLocales: [
    { code: 'fr', name: 'French' },
    { code: 'ar', name: 'Arabic' },
  ],
  contentTypes: [{ uid: 'api::article.article', localized: true, draftAndPublish: true }],
  aiTranslationsEnabled: false,
  createMissingLocales: true,
  autoPublish: false,
};
export const failedJob: JobSummary = {
  id: 1,
  contentType: 'api::article.article',
  documentId: 'article-one',
  sourceLocale: 'en',
  targetLocale: 'fr',
  status: 'failed',
  stage: 'translate',
  attempts: 1,
  error: null,
  createdAt: '2026-10-10T10:00:00Z',
  updatedAt: '2026-10-10T10:00:01Z',
};
