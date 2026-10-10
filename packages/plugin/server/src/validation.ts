import { z } from 'zod';
import type {
  Diagnostic,
  JsonValue,
  PreparedTranslation,
  TranslationJob,
  PluginSettings,
} from '../../shared/contracts';
import { messages } from '../../shared/messages';
import {
  MAX_DOCUMENTS_PER_REQUEST,
  HTTP_BAD_REQUEST_STATUS,
  PROJECT_ID_MAX_LENGTH,
  DOCUMENT_ID_MAX_LENGTH,
} from '../../shared/constants';

export class DiagnosticError extends Error {
  constructor(
    readonly diagnostic: Diagnostic,
    readonly status = HTTP_BAD_REQUEST_STATUS
  ) {
    super(diagnostic.text);
    this.name = 'DiagnosticError';
  }
}
export function fail(reason: string): never {
  throw new DiagnosticError(messages.validation(reason));
}
export const objectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
export const jsonValue: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(jsonValue),
    z.record(z.string(), jsonValue),
  ])
);
export const jsonObject = z.record(z.string(), jsonValue);
export const fieldRule = z
  .object({
    translate: z.boolean(),
    context: z.string().max(4000).optional(),
    uidStrategy: z.enum(['copy', 'regenerate']).optional(),
    sourceField: z.string().optional(),
  })
  .strict();
export const settingsSchema = z
  .object({
    projectId: z.string().trim().max(PROJECT_ID_MAX_LENGTH),
    sourceLocale: z.string().min(1),
    targetLocales: z.array(z.string().min(1)),
    localeMapping: z.record(z.string(), z.string().min(1)),
    contentTypes: z.record(
      z.string(),
      z.object({ fields: z.record(z.string(), fieldRule), mediaMetadata: z.boolean() }).strict()
    ),
    createMissingLocales: z.boolean(),
    autoPublish: z.boolean(),
    automaticMode: z.enum(['off', 'save', 'publish']),
  })
  .strict();
export const requestSchema = z
  .object({
    contentType: z.string().min(1),
    documentIds: z
      .array(z.string().min(1).max(DOCUMENT_ID_MAX_LENGTH))
      .min(1)
      .max(MAX_DOCUMENTS_PER_REQUEST),
    targetLocales: z.array(z.string().min(1)).min(1),
    force: z.boolean(),
  })
  .strict();
export const diagnosticSchema = z.object({
  code: z.string(),
  level: z.enum(['error', 'warning', 'success']),
  text: z.string(),
  details: z.record(z.string(), z.string()),
  docs: z.string().optional(),
});
export const schemaSchema = z.object({
  uid: z.string(),
  localized: z.boolean(),
  draftAndPublish: z.boolean(),
  attributes: z.record(
    z.string(),
    z.object({
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
    })
  ),
});
export const checkpointsSchema = z.record(
  z.string(),
  z.object({ sourceHash: z.string(), targetHash: z.string() })
);
export const preparedSchema: z.ZodType<PreparedTranslation> = z.object({
  input: z.object({
    schema: schemaSchema,
    components: z.record(z.string(), schemaSchema),
    source: jsonObject,
    target: jsonObject.nullable(),
    rules: z.record(z.string(), fieldRule),
    checkpoints: checkpointsSchema,
    force: z.boolean(),
    mediaMetadata: z.boolean(),
  }),
  sourceHash: z.string(),
  targetHash: z.string(),
  segments: z.array(
    z.object({
      id: z.string(),
      path: z.array(z.union([z.string(), z.number().int().nonnegative()])),
      text: z.string(),
      context: z.string().optional(),
      kind: z.enum(['text', 'markdown', 'media-alt', 'media-caption']),
    })
  ),
  protectedPaths: z.array(z.string()),
  unchangedPaths: z.array(z.string()),
});
export const fileSchema = z.object({
  fileId: z.string(),
  versionId: z.string(),
  branchId: z.string(),
});
export interface StoredJob extends TranslationJob {
  settings: PluginSettings;
  sourceStatus: 'draft' | 'published';
  permission: 'translate' | 'bulkTranslate';
  runtimeProgress?: Record<string, string>;
}
export const jobSchema: z.ZodType<StoredJob> = z.object({
  id: z.number().int().positive(),
  key: z.string(),
  contentType: z.string(),
  documentId: z.string(),
  sourceLocale: z.string(),
  targetLocale: z.string(),
  actorId: z.number().int().positive().nullable(),
  force: z.boolean(),
  status: z.enum(['queued', 'running', 'waiting', 'succeeded', 'failed', 'conflict']),
  stage: z.enum(['prepare', 'translate', 'upload', 'enqueue', 'poll', 'download', 'apply']),
  attempts: z.number().int().nonnegative(),
  nextRunAt: z.string(),
  leaseOwner: z.string().nullable(),
  leaseUntil: z.string().nullable(),
  prepared: preparedSchema.nullable(),
  file: fileSchema.nullable(),
  remoteJobIds: z.array(z.string()),
  translations: z.record(z.string(), z.string()),
  error: diagnosticSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  settings: settingsSchema,
  sourceStatus: z.enum(['draft', 'published']),
  permission: z.enum(['translate', 'bulkTranslate']),
  runtimeProgress: z.record(z.string(), z.string()).default({}),
});
export const parseBody = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value);
  if (!result.success)
    return fail(result.error.issues.map((issue) => issue.path.join('.') || 'request').join(', '));
  return result.data;
};
