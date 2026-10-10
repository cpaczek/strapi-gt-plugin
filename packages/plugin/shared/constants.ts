import type { ContentTypeSettings, FieldRule, PluginSettings } from './contracts';

export const UID_FALLBACK_PREFIX = 'entry';
export const PLUGIN_ID = 'general-translation';
export const MESSAGE_PREFIX = 'General Translation:';
export const GT_BASE_URL = 'https://api.gtx.dev';
export const GT_API_VERSION = '2026-03-06.v1';
export const DOCS_URL = 'https://generaltranslation.com/docs';
export const REQUEST_TIMEOUT_MS = 30_000;
export const STRAPI_BASE_URL = 'http://127.0.0.1:1337';
export const LIVE_SMOKE_TIMEOUT_MS = 600_000;
export const LIVE_STRAPI_PORT = 1537;
export const LIVE_READER_PORT = 3300;
export const MILLISECONDS_PER_SECOND = 1_000;
export const WORKER_POLL_MS = MILLISECONDS_PER_SECOND;
export const JOB_LEASE_MS = 120_000;
export const RETRY_BASE_MS = 2_000;
export const RETRY_MAX_MS = 60_000;
export const RETRY_LIMIT = 5;
export const WORKER_CONCURRENCY = 3;
export const RUNTIME_BATCH_BYTES = 8_000;
export const RUNTIME_BATCH_ENTRIES = 50;
export const FILE_BATCH_LIMIT = 100;
export const MAX_SOURCE_BYTES = 2_000_000;
export const MAX_DOCUMENTS_PER_REQUEST = 200;
export const MAX_JOBS_PER_REQUEST = 200;
export const MAX_ENQUEUE_BYTES = 32_000_000;
export const JOB_HISTORY_PAGE_SIZE = 25;
export const UI_POLL_MS = 2_500;
export const ERROR_DETAIL_LIMIT = 400;
export const SETTINGS_STORE_KEY = 'settings';
export const SETTINGS_ACTION = 'settings';
export const HTTP_BAD_REQUEST_STATUS = 400;
export const PROJECT_ID_MAX_LENGTH = 200;
export const DOCUMENT_ID_MAX_LENGTH = 200;
export const DEFAULT_FIELD_RULE: FieldRule = { translate: true };
export const DEFAULT_CONTENT_TYPE_SETTINGS: ContentTypeSettings = {
  fields: {},
  mediaMetadata: false,
};
export const PERMISSIONS = {
  readSettings: `plugin::${PLUGIN_ID}.read-settings`,
  writeSettings: `plugin::${PLUGIN_ID}.write-settings`,
  translate: `plugin::${PLUGIN_ID}.translate`,
  bulkTranslate: `plugin::${PLUGIN_ID}.bulk-translate`,
} as const;

export const DEFAULT_SETTINGS: PluginSettings = {
  projectId: '',
  sourceLocale: 'en',
  targetLocales: [],
  localeMapping: {},
  contentTypes: {},
  createMissingLocales: false,
  autoPublish: false,
  automaticMode: 'off',
};
