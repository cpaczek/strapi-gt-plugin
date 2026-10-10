import { z } from 'zod';
import type {
  ConnectionResponse,
  ContentSchema,
  Diagnostic,
  EnqueueResponse,
  JobListResponse,
  MediaOverlayResponse,
  SettingsResponse,
  TranslationOptionsResponse,
} from '../../shared/contracts';
import { messages } from '../../shared/messages';

const strings = z.record(z.string(), z.string());
const diagnostic: z.ZodType<Diagnostic> = z.object({
  code: z.string(),
  level: z.enum(['error', 'warning', 'success']),
  text: z.string(),
  details: strings,
  docs: z.string().optional(),
});
const field = z.object({
  type: z.enum([
    'string',
    'text',
    'richtext',
    'blocks',
    'component',
    'dynamiczone',
    'media',
    'uid',
    'relation',
    'integer',
    'biginteger',
    'float',
    'decimal',
    'boolean',
    'date',
    'time',
    'datetime',
    'timestamp',
    'enumeration',
    'json',
    'email',
    'password',
  ]),
  localized: z.boolean().optional(),
  private: z.boolean().optional(),
  component: z.string().optional(),
  components: z.array(z.string()).optional(),
  repeatable: z.boolean().optional(),
  targetField: z.string().optional(),
  required: z.boolean().optional(),
});
const contentSchema: z.ZodType<ContentSchema> = z.object({
  uid: z.string(),
  attributes: z.record(z.string(), field),
  draftAndPublish: z.boolean(),
  localized: z.boolean(),
});
const locale = z.object({ code: z.string(), name: z.string() });
export const settingsSchema: z.ZodType<SettingsResponse> = z.object({
  settings: z.object({
    projectId: z.string(),
    sourceLocale: z.string(),
    targetLocales: z.array(z.string()),
    localeMapping: strings,
    contentTypes: z.record(
      z.string(),
      z.object({
        mediaMetadata: z.boolean(),
        fields: z.record(
          z.string(),
          z.object({
            translate: z.boolean(),
            context: z.string().optional(),
            uidStrategy: z.enum(['copy', 'regenerate']).optional(),
            sourceField: z.string().optional(),
          })
        ),
      })
    ),
    createMissingLocales: z.boolean(),
    autoPublish: z.boolean(),
    automaticMode: z.enum(['off', 'save', 'publish']),
  }),
  hasApiKey: z.boolean(),
  maskedApiKey: z.string().regex(/^\**$/),
  locales: z.array(locale),
  supportedLocales: z.array(z.string()),
  contentTypes: z.array(contentSchema),
  components: z.record(z.string(), contentSchema),
  aiTranslationsEnabled: z.boolean(),
});
export const optionsSchema: z.ZodType<TranslationOptionsResponse> = z.object({
  configured: z.boolean(),
  sourceLocale: z.string(),
  targetLocales: z.array(locale),
  contentTypes: z.array(
    z.object({ uid: z.string(), localized: z.boolean(), draftAndPublish: z.boolean() })
  ),
  aiTranslationsEnabled: z.boolean(),
  createMissingLocales: z.boolean(),
  autoPublish: z.boolean(),
});
const job = z.object({
  id: z.number().int().positive(),
  contentType: z.string(),
  documentId: z.string(),
  sourceLocale: z.string(),
  targetLocale: z.string(),
  status: z.enum(['queued', 'running', 'waiting', 'succeeded', 'failed', 'conflict']),
  stage: z.enum(['prepare', 'translate', 'upload', 'enqueue', 'poll', 'download', 'apply']),
  attempts: z.number().int().nonnegative(),
  error: diagnostic.nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export const jobsSchema: z.ZodType<JobListResponse> = z.object({
  jobs: z.array(job),
  total: z.number().int().nonnegative(),
});
export const enqueueSchema: z.ZodType<EnqueueResponse> = z.object({ jobs: z.array(job) });
export const connectionSchema: z.ZodType<ConnectionResponse> = z.object({
  project: z.object({
    id: z.string(),
    name: z.string(),
    sourceLocale: z.string(),
    locales: z.array(z.string()),
  }),
  message: diagnostic,
});
export const mediaSchema: z.ZodType<MediaOverlayResponse> = z.object({
  draftAndPublish: z.boolean(),
  items: z.array(
    z.object({
      path: z.array(z.union([z.string(), z.number().int().nonnegative()])),
      assetId: z.string(),
      property: z.enum(['alternativeText', 'caption']),
      source: z.string().nullable(),
      value: z.string().nullable(),
      status: z.enum(['source', 'translated', 'manual', 'stale']),
    })
  ),
});
export const requestDiagnostic = (failure: unknown): Diagnostic => {
  const parsed = z
    .object({ response: z.object({ data: z.object({ error: diagnostic }) }) })
    .safeParse(failure);
  return parsed.success ? parsed.data.response.data.error : messages.adminRequestFailure();
};
