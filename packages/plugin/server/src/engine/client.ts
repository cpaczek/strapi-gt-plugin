import {
  ApiError,
  createApiClient,
  downloadFiles,
  enqueueFileTranslations,
  getFileInfo,
  getProjectInfo,
  getTranslationJobInfo,
  translate,
  uploadSourceFiles,
  type DownloadFilesData,
  type EnqueueFileTranslationsData,
  type GetFileInfoData,
  type GetTranslationJobInfoData,
  type RuntimeTranslationRequest,
  type UploadSourceFilesData,
} from '@generaltranslation/api';
import { z } from 'zod';
import {
  GT_API_VERSION,
  MAX_SOURCE_BYTES,
  MILLISECONDS_PER_SECOND,
  REQUEST_TIMEOUT_MS,
  RUNTIME_BATCH_BYTES,
  RUNTIME_BATCH_ENTRIES,
} from '../../../shared/constants';
import type {
  GtClient,
  GtFileReference,
  GtTranslationRequest,
  ResolvedGtConfig,
  TranslationSegment,
} from '../../../shared/contracts';
import { messages } from '../../../shared/messages';
import { hasTranslationContext } from './context';
import { GtRequestError, invalidTranslation } from './errors';
import { hashValue } from './hash';
import { resolveGtLocale } from './locales';

const referenceSchema = z.object({
  fileId: z.string().min(1),
  versionId: z.string().min(1),
  branchId: z.string().min(1),
});
const projectSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  defaultLocale: z.string().min(1),
  currentLocales: z.array(z.string()),
});
const runtimeItemSchema = z.discriminatedUnion('success', [
  z.object({
    success: z.literal(true),
    translation: z.string(),
    dataFormat: z.literal('STRING'),
    locale: z.string(),
  }),
  z.object({ success: z.literal(false), code: z.number(), error: z.string() }),
]);
const uploadSchema = z.object({
  uploadedFiles: z.array(
    referenceSchema.extend({ fileName: z.string(), fileFormat: z.literal('JSON') })
  ),
  count: z.number(),
});
const enqueueSchema = z.object({
  jobData: z.record(
    z.string(),
    referenceSchema.extend({ targetLocale: z.string(), projectId: z.string() })
  ),
});
const jobsSchema = z.array(
  z.object({
    jobId: z.string(),
    status: z.enum(['queued', 'processing', 'completed', 'failed', 'unknown']),
  })
);
const fileInfoSchema = z.object({
  translatedFiles: z.array(
    referenceSchema.extend({ locale: z.string(), completedAt: z.string().nullable() })
  ),
});
const downloadSchema = z.object({
  files: z.array(
    referenceSchema.extend({ locale: z.string(), data: z.string(), fileFormat: z.literal('JSON') })
  ),
  count: z.number(),
  pending: z.array(referenceSchema.extend({ locale: z.string() })).optional(),
});

const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const checked = schema.safeParse(value);
  if (!checked.success)
    throw invalidTranslation('GT returned a response that does not match the public API contract');
  return checked.data;
};
const sameReference = (actual: GtFileReference, expected: GtFileReference): boolean =>
  actual.fileId === expected.fileId &&
  actual.versionId === expected.versionId &&
  actual.branchId === expected.branchId;
const interruptedRequest = (httpStatus?: number): GtRequestError =>
  new GtRequestError(messages.interruptedRequest(), false, undefined, {
    acceptance: 'unknown',
    httpStatus,
  });

const httpFailure = (status: number, retryAfter?: string | null, paid = false): GtRequestError => {
  if (paid && (status === 408 || status >= 500)) return interruptedRequest(status);
  const seconds =
    retryAfter && /^\d+(?:\.\d+)?$/.test(retryAfter)
      ? Number(retryAfter) * MILLISECONDS_PER_SECOND
      : undefined;
  const dateDelay =
    retryAfter && seconds === undefined ? Date.parse(retryAfter) - Date.now() : undefined;
  const delay = seconds ?? dateDelay;
  const retryAfterMs =
    delay !== undefined && Number.isFinite(delay) ? Math.max(0, delay) : undefined;
  const diagnostic =
    status === 401
      ? messages.invalidKey()
      : status === 402
        ? messages.quotaExhausted()
        : status === 403
          ? messages.permissionDenied()
          : messages.providerFailure(`GT returned HTTP ${status}`);
  return new GtRequestError(
    diagnostic,
    status === 408 || status === 425 || status === 429 || status >= 500,
    retryAfterMs,
    { acceptance: 'rejected', httpStatus: status }
  );
};

const validateRequest = (request: GtTranslationRequest): void => {
  resolveGtLocale(request.sourceLocale, {});
  resolveGtLocale(request.targetLocale, {});
  const ids = new Set<string>();
  for (const segment of request.segments) {
    if (!segment.id || ids.has(segment.id) || typeof segment.text !== 'string')
      throw invalidTranslation('Translation segment identities must be present and unique');
    ids.add(segment.id);
  }
  if (Buffer.byteLength(JSON.stringify(request), 'utf8') > MAX_SOURCE_BYTES)
    throw invalidTranslation('The translation payload exceeds the request size limit');
};
const runtimeEntry = (segment: TranslationSegment, request: GtTranslationRequest) => ({
  source: segment.text,
  metadata: {
    id: segment.id,
    hash: hashValue({
      text: segment.text,
      context: segment.context ?? null,
      sourceLocale: request.sourceLocale,
      targetLocale: request.targetLocale,
    }),
    dataFormat: 'STRING' as const,
    ...(segment.context !== undefined ? { context: segment.context } : {}),
  },
});
const runtimeBody = (
  segments: TranslationSegment[],
  request: GtTranslationRequest
): RuntimeTranslationRequest => ({
  requests: Object.fromEntries(
    segments.map((segment) => [segment.id, runtimeEntry(segment, request)])
  ),
  sourceLocale: request.sourceLocale,
  targetLocale: request.targetLocale,
  metadata: {},
});

interface RuntimePart {
  originalId: string;
  segment: TranslationSegment;
  prefix: string;
  suffix: string;
}

const runtimeParts = (request: GtTranslationRequest): RuntimePart[] =>
  request.segments.flatMap((segment) => {
    if (Buffer.byteLength(JSON.stringify(runtimeBody([segment], request))) <= RUNTIME_BATCH_BYTES) {
      return [{ originalId: segment.id, segment, prefix: '', suffix: '' }];
    }
    const parts: RuntimePart[] = [];
    const chunkId = (index: number): string => hashValue(['runtime-part', segment.id, index]);
    const overhead = Buffer.byteLength(
      JSON.stringify(runtimeBody([{ ...segment, id: chunkId(0), text: '' }], request))
    );
    const budget = RUNTIME_BATCH_BYTES - overhead;
    if (budget <= 0)
      throw invalidTranslation(
        'The field context is too large for runtime translation; shorten the context'
      );
    const flush = (text: string): void => {
      const prefix = text.slice(0, text.length - text.trimStart().length);
      const remaining = text.slice(prefix.length);
      const suffix = remaining.slice(remaining.trimEnd().length);
      parts.push({
        originalId: segment.id,
        segment: {
          ...segment,
          id: chunkId(parts.length),
          text: remaining.slice(0, remaining.length - suffix.length),
        },
        prefix,
        suffix,
      });
    };
    let chunk = '';
    let bytes = 0;
    const graphemes = new Intl.Segmenter(request.sourceLocale, { granularity: 'grapheme' }).segment(
      segment.text
    );
    for (const { segment: grapheme } of graphemes) {
      const length = Buffer.byteLength(JSON.stringify(grapheme)) - 2;
      if (length > budget)
        throw invalidTranslation('A text grapheme exceeds the runtime translation size limit');
      if (bytes + length > budget) {
        flush(chunk);
        chunk = '';
        bytes = 0;
      }
      chunk += grapheme;
      bytes += length;
    }
    if (chunk) flush(chunk);
    return parts;
  });

export const createGtClient = (config: ResolvedGtConfig): GtClient => {
  if (!config.apiKey) throw new GtRequestError(messages.missingKey());
  if (!config.projectId) throw invalidTranslation('Set the GT project ID before translating');
  const base = new URL(config.baseUrl);
  if (base.username || base.password || !['http:', 'https:'].includes(base.protocol))
    throw invalidTranslation('The GT API URL must be an HTTP address without embedded credentials');
  const client = createApiClient({
    ...config,
    apiVersion: GT_API_VERSION,
    retryPolicy: 'none',
    timeoutMs: REQUEST_TIMEOUT_MS,
  });
  const invoke = async <T>(
    operation: () => Promise<{ data?: unknown; error?: unknown; response: Response }>,
    schema: z.ZodType<T>,
    paid = false
  ): Promise<T> => {
    try {
      const result = await operation();
      if (result.error instanceof ApiError) throw result.error;
      if (!result.response.ok)
        throw httpFailure(result.response.status, result.response.headers.get('retry-after'), paid);
      const checked = schema.safeParse(result.data);
      if (!checked.success) {
        if (paid) throw interruptedRequest(result.response.status);
        throw invalidTranslation(
          'GT returned a response that does not match the public API contract'
        );
      }
      return checked.data;
    } catch (failure) {
      if (failure instanceof GtRequestError) throw failure;
      if (failure instanceof ApiError) throw httpFailure(failure.code, undefined, paid);
      if (paid) throw interruptedRequest();
      throw new GtRequestError(
        messages.networkFailure('The request timed out or the server connection was interrupted'),
        true,
        undefined,
        { acceptance: 'unknown' }
      );
    }
  };
  const testConnection: GtClient['testConnection'] = async () => {
    const project = await invoke(
      () => getProjectInfo({ client, path: { projectId: config.projectId } }),
      projectSchema
    );
    if (project.id !== config.projectId)
      throw invalidTranslation('GT returned a different project than the configured project');
    return {
      id: project.id,
      name: project.name,
      sourceLocale: project.defaultLocale,
      locales: project.currentLocales,
    };
  };
  const translateSegments: GtClient['translate'] = async (request, progress) => {
    validateRequest(request);
    const requestHash = hashValue({
      apiVersion: GT_API_VERSION,
      projectId: config.projectId,
      baseUrl: config.baseUrl,
      sourceLocale: request.sourceLocale,
      targetLocale: request.targetLocale,
      segments: Object.fromEntries(
        request.segments.map((entry) => [
          entry.id,
          {
            text: entry.text,
            context: entry.context ?? null,
            kind: entry.kind,
            path: [...entry.path],
          },
        ])
      ),
    });
    const parts = runtimeParts(request).map((part) => ({
      ...part,
      checkpointId: hashValue([requestHash, part.originalId, part.segment.id]),
    }));
    const plan = new Map(parts.map((part) => [part.checkpointId, part]));
    if (plan.size !== parts.length)
      throw invalidTranslation('Runtime chunk identities must be unique');
    const completed = new Map(
      Object.entries(parse(z.record(z.string(), z.string()), progress?.completed ?? {}))
    );
    for (const [id, text] of completed) {
      const part = plan.get(id);
      if (!part || (!part.segment.text && text !== ''))
        throw invalidTranslation('Saved runtime progress does not match this translation request');
    }
    let batch: typeof parts = [];
    const send = async (): Promise<void> => {
      if (!batch.length) return;
      const body = runtimeBody(
        batch.map((part) => part.segment),
        request
      );
      const response = await invoke(
        () => translate({ client, body }),
        z.record(z.string(), z.unknown()),
        true
      );
      const failures: GtRequestError[] = [];
      if (
        Object.keys(response).length !== batch.length ||
        Object.keys(response).some((id) => !batch.some((part) => part.segment.id === id))
      )
        failures.push(interruptedRequest());
      let saved = false;
      for (const part of batch) {
        const checked = runtimeItemSchema.safeParse(
          Object.hasOwn(response, part.segment.id) ? response[part.segment.id] : undefined
        );
        if (!checked.success) {
          failures.push(interruptedRequest());
          continue;
        }
        const item = checked.data;
        if (!item.success) {
          failures.push(httpFailure(item.code));
          continue;
        }
        if (item.locale !== request.targetLocale) {
          failures.push(interruptedRequest());
          continue;
        }
        completed.set(part.checkpointId, item.translation);
        saved = true;
      }
      if (saved && progress) {
        try {
          await progress.onProgress(Object.fromEntries(completed));
        } catch {
          throw interruptedRequest();
        }
      }
      const failure =
        failures.find((entry) => entry.acceptance === 'unknown') ??
        failures.find((entry) => !entry.retryable) ??
        failures[0];
      if (failure) throw failure;
      batch = [];
    };
    for (const part of parts) {
      if (completed.has(part.checkpointId)) continue;
      if (!part.segment.text) {
        completed.set(part.checkpointId, '');
        continue;
      }
      const candidate = [...batch, part];
      if (
        batch.length &&
        (candidate.length > RUNTIME_BATCH_ENTRIES ||
          Buffer.byteLength(
            JSON.stringify(
              runtimeBody(
                candidate.map((entry) => entry.segment),
                request
              )
            ),
            'utf8'
          ) > RUNTIME_BATCH_BYTES)
      )
        await send();
      batch.push(part);
    }
    await send();
    const merged = new Map<string, string>();
    for (const part of parts) {
      const translated = completed.get(part.checkpointId);
      if (translated === undefined)
        throw invalidTranslation('A runtime translation chunk is missing');
      merged.set(
        part.originalId,
        (merged.get(part.originalId) ?? '') + part.prefix + translated + part.suffix
      );
    }
    return Object.fromEntries(merged);
  };
  return {
    testConnection,
    translate: translateSegments,
    async upload(request, fileName) {
      validateRequest(request);
      if (request.segments.some((segment) => hasTranslationContext(segment.context)))
        throw invalidTranslation(
          'Field context requires runtime translation until GT documents contextual file uploads'
        );
      const project = await testConnection();
      if (resolveGtLocale(project.sourceLocale, {}) !== resolveGtLocale(request.sourceLocale, {}))
        throw new GtRequestError(messages.sourceLocaleMismatch(project.sourceLocale));
      const content = JSON.stringify(
        Object.fromEntries(request.segments.map((segment) => [segment.id, segment.text]))
      );
      const body: UploadSourceFilesData['body'] = {
        data: [
          {
            source: {
              content: Buffer.from(content, 'utf8').toString('base64'),
              fileName,
              fileFormat: 'JSON',
              locale: request.sourceLocale,
            },
          },
        ],
        sourceLocale: request.sourceLocale,
      };
      const response = await invoke(() => uploadSourceFiles({ client, body }), uploadSchema);
      const uploaded = response.uploadedFiles[0];
      if (
        response.count !== 1 ||
        response.uploadedFiles.length !== 1 ||
        !uploaded ||
        uploaded.fileName !== fileName
      )
        throw invalidTranslation('GT did not return the requested uploaded file');
      return {
        fileId: uploaded.fileId,
        versionId: uploaded.versionId,
        branchId: uploaded.branchId,
      };
    },
    async enqueue(reference, request, force) {
      validateRequest(request);
      parse(referenceSchema, reference);
      const body: EnqueueFileTranslationsData['body'] = {
        files: [reference],
        sourceLocale: request.sourceLocale,
        targetLocales: [request.targetLocale],
        force,
      };
      const response = await invoke(
        () => enqueueFileTranslations({ client, body }),
        enqueueSchema,
        true
      );
      for (const job of Object.values(response.jobData)) {
        if (
          !sameReference(job, reference) ||
          job.targetLocale !== request.targetLocale ||
          job.projectId !== config.projectId
        )
          throw interruptedRequest();
      }
      return Object.keys(response.jobData);
    },
    async poll(reference, targetLocale, jobIds) {
      parse(referenceSchema, reference);
      resolveGtLocale(targetLocale, {});
      if (jobIds.length) {
        const body: GetTranslationJobInfoData['body'] = { jobIds };
        const jobs = await invoke(() => getTranslationJobInfo({ client, body }), jobsSchema);
        if (
          jobs.length !== jobIds.length ||
          new Set(jobs.map((job) => job.jobId)).size !== jobIds.length ||
          jobs.some((job) => !jobIds.includes(job.jobId))
        )
          throw invalidTranslation('GT returned incomplete translation job statuses');
        if (jobs.some((job) => job.status === 'failed' || job.status === 'unknown'))
          return {
            status: 'failed',
            message: messages.providerFailure(
              'A persisted GT job failed or is no longer available'
            ),
          };
        if (jobs.some((job) => job.status !== 'completed')) return { status: 'pending' };
      }
      const body: GetFileInfoData['body'] = {
        translatedFiles: [{ ...reference, locale: targetLocale }],
      };
      const response = await invoke(() => getFileInfo({ client, body }), fileInfoSchema);
      const matches = response.translatedFiles.filter(
        (file) => sameReference(file, reference) && file.locale === targetLocale
      );
      if (matches.length > 1 || response.translatedFiles.length !== matches.length)
        throw invalidTranslation('GT returned file readiness for an unexpected version or locale');
      return { status: matches[0]?.completedAt ? 'ready' : 'pending' };
    },
    async download(reference, targetLocale) {
      parse(referenceSchema, reference);
      resolveGtLocale(targetLocale, {});
      const body: DownloadFilesData['body'] = [
        { ...reference, locale: targetLocale, useLatestAvailableVersion: false },
      ];
      const response = await invoke(() => downloadFiles({ client, body }), downloadSchema);
      if (response.pending?.length)
        throw new GtRequestError(
          messages.providerFailure('The requested file version is still being translated'),
          true
        );
      const file = response.files[0];
      if (
        response.count !== 1 ||
        response.files.length !== 1 ||
        !file ||
        !sameReference(file, reference) ||
        file.locale !== targetLocale
      )
        throw invalidTranslation('GT did not return the exact requested translated file version');
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.data))
        throw invalidTranslation('GT returned a file that is not valid base64');
      const bytes = Buffer.from(file.data, 'base64');
      if (bytes.length > MAX_SOURCE_BYTES)
        throw invalidTranslation('The translated file exceeds the content size limit');
      let decoded: unknown;
      try {
        decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      } catch {
        throw invalidTranslation('GT returned a translated file that is not valid UTF-8 JSON');
      }
      return parse(z.record(z.string(), z.string()), decoded);
    },
  };
};
