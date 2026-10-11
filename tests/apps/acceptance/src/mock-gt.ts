import { createHash } from 'node:crypto';
import { createServer, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { isIP, type Socket } from 'node:net';
import type {
  DownloadFilesResponse,
  EnqueueFileTranslationsResponse,
  GetFileInfoResponse,
  GetProjectInfoResponse,
  GetTranslationJobInfoResponse,
  RuntimeTranslationResponse,
  UploadSourceFilesResponse,
} from '@generaltranslation/api';
import { z } from 'zod';

const fileIdentity = z.object({
  fileId: z.string(),
  versionId: z.string(),
  branchId: z.string().default('main'),
});
const localizedIdentity = fileIdentity.extend({ locale: z.string() });
const runtimeRequest = z.object({
  requests: z.record(
    z.string(),
    z.object({
      source: z.string(),
      metadata: z.object({ context: z.string().optional() }).passthrough().optional(),
    })
  ),
  sourceLocale: z.string(),
  targetLocale: z.string(),
  metadata: z.object({}).passthrough(),
});
const uploadRequest = z.object({
  sourceLocale: z.string().optional(),
  data: z
    .array(
      z.object({
        source: z.object({
          content: z.string(),
          fileName: z.string(),
          fileFormat: z.enum(['JSON', 'TXT']),
          locale: z.string(),
          fileId: z.string().optional(),
          versionId: z.string().optional(),
          branchId: z.string().optional(),
        }),
      })
    )
    .max(100),
});
const enqueueRequest = z.object({
  files: z.array(fileIdentity),
  targetLocales: z.array(z.string()).default([]),
  force: z.boolean().optional(),
});
const fileInfoRequest = z.object({
  sourceFiles: z.array(fileIdentity).optional(),
  translatedFiles: z.array(localizedIdentity).optional(),
});
const jobInfoRequest = z.object({ jobIds: z.array(z.string()) });
const downloadRequest = z.array(
  localizedIdentity.extend({ useLatestAvailableVersion: z.boolean().optional() })
);

type JobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'unknown';
interface MockFile {
  fileId: string;
  versionId: string;
  branchId: string;
  fileName: string;
  fileFormat: 'JSON' | 'TXT';
  locale: string;
  content: string;
}
interface MockJob {
  jobId: string;
  file: MockFile;
  locale: string;
}
export interface RecordedRequest {
  method: string;
  path: string;
  body: unknown;
  projectId: string | undefined;
  apiVersion: string | undefined;
}
interface Failure {
  status: number;
  retryAfter?: string;
}
export interface MockGtServer {
  url: string;
  requests: RecordedRequest[];
  failNext: (failure: Failure) => void;
  failEntries: (ids: string[]) => void;
  setJobStatus: (status: JobStatus) => void;
  close: () => Promise<void>;
}
export interface MockConnectionEvent {
  event: 'connection' | 'request' | 'response-finish' | 'timeout' | 'close';
  at: string;
  connectionId?: number;
  idleDeadlineMs?: number;
  hadError?: boolean;
}
interface MockOptions {
  onConnectionEvent?: (event: MockConnectionEvent) => void;
  apiKey: string;
  port?: number;
  projectId?: string;
  identity?: boolean;
  controlToken?: string;
}

export const isLoopbackAddress = (address: string | undefined): boolean => {
  if (!address) return false;
  const normalized = address.toLowerCase();
  if (normalized === '::1') return true;
  const ipv4 = normalized.startsWith('::ffff:') ? normalized.slice('::ffff:'.length) : normalized;
  return isIP(ipv4) === 4 && ipv4.startsWith('127.');
};
const controlStatus = z.strictObject({ status: z.enum(['processing', 'completed']) });

const send = (
  response: ServerResponse,
  status: number,
  body: unknown,
  retryAfter?: string
): void => {
  // Synchronous Strapi work can outlast idle timers in this same-process mock.
  response.writeHead(status, {
    connection: 'close',
    'content-type': 'application/json',
    ...(retryAfter ? { 'retry-after': retryAfter } : {}),
  });
  response.end(JSON.stringify(body));
};
const digest = (value: string): string =>
  createHash('sha256').update(value).digest('hex').slice(0, 24);
const key = (file: { fileId: string; versionId: string; branchId: string }): string =>
  `${file.branchId}/${file.fileId}/${file.versionId}`;
const stamp = '2026-01-01T00:00:00.000Z';

export const startMockGt = async (options: MockOptions): Promise<MockGtServer> => {
  const requests: RecordedRequest[] = [];
  const connections = new WeakMap<Socket, number>();
  let connectionId = 0;
  const failures: Failure[] = [];
  const failedEntries = new Set<string>();
  const files = new Map<string, MockFile>();
  const jobs = new Map<string, MockJob>();
  const state: { status: JobStatus } = { status: 'completed' };
  const projectId = options.projectId ?? 'editorial';
  const render = (text: string, locale: string): string =>
    options.identity || text === '' ? text : `[${locale}] ${text}`;
  const renderJson = (value: unknown, locale: string): unknown => {
    if (typeof value === 'string') return render(value, locale);
    if (Array.isArray(value)) return value.map((entry: unknown) => renderJson(entry, locale));
    if (typeof value === 'object' && value !== null)
      return Object.fromEntries(
        Object.entries(value).map(([name, entry]) => [name, renderJson(entry, locale)])
      );
    return value;
  };
  const isReady = (file: {
    fileId: string;
    versionId: string;
    branchId: string;
    locale: string;
  }): boolean =>
    state.status === 'completed' &&
    [...jobs.values()].some((job) => key(job.file) === key(file) && job.locale === file.locale);
  const server = createServer(async (request, response) => {
    const id = connections.get(request.socket);
    options.onConnectionEvent?.({
      event: 'request',
      at: new Date().toISOString(),
      connectionId: id,
    });
    response.once('finish', () =>
      options.onConnectionEvent?.({
        event: 'response-finish',
        at: new Date().toISOString(),
        connectionId: id,
        idleDeadlineMs: server.keepAliveTimeout + (server.keepAliveTimeoutBuffer ?? 0),
      })
    );
    const chunks: Buffer[] = [];
    try {
      for await (const chunk of request) {
        if (!Buffer.isBuffer(chunk)) throw new TypeError('Expected a binary HTTP body');
        chunks.push(chunk);
        if (chunks.reduce((total, part) => total + part.length, 0) > 4_000_000) {
          send(response, 413, { error: 'Mock request is too large' });
          return;
        }
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      const body: unknown = raw ? JSON.parse(raw) : undefined;
      const path = new URL(request.url ?? '/', 'http://localhost').pathname;
      if (path.startsWith('/__test__/')) {
        if (!options.controlToken) {
          send(response, 404, { error: 'Unknown mock endpoint' });
          return;
        }
        if (!isLoopbackAddress(request.socket.remoteAddress)) {
          send(response, 403, { error: 'Controls require a loopback client' });
          return;
        }
        if (request.headers.authorization !== `Bearer ${options.controlToken}`) {
          send(response, 401, { error: 'Invalid control credentials' });
          return;
        }
        if (request.method === 'POST' && path === '/__test__/job-status') {
          state.status = controlStatus.parse(body).status;
          send(response, 200, { status: state.status });
        } else if (request.method === 'GET' && path === '/__test__/requests') {
          const count = (endpoint: string) =>
            requests.filter((entry) => entry.path === endpoint).length;
          send(response, 200, {
            runtimeRequests: count('/v2/translate'),
            uploads: count('/v2/project/files/upload-files'),
            enqueues: count('/v2/project/translations/enqueue'),
            polls: count('/v2/project/jobs/info'),
            downloads: count('/v2/project/files/download'),
          });
        } else send(response, 404, { error: 'Unknown control endpoint' });
        return;
      }
      requests.push({
        method: request.method ?? 'GET',
        path,
        body,
        projectId:
          typeof request.headers['gt-project-id'] === 'string'
            ? request.headers['gt-project-id']
            : undefined,
        apiVersion:
          typeof request.headers['gt-api-version'] === 'string'
            ? request.headers['gt-api-version']
            : undefined,
      });
      if (request.headers.authorization !== `Bearer ${options.apiKey}`) {
        send(response, 401, { error: 'Invalid mock credentials' });
        return;
      }
      const failure = failures.shift();
      if (failure) {
        send(response, failure.status, { error: 'Deterministic test failure' }, failure.retryAfter);
        return;
      }
      if (request.method === 'GET' && path === `/v2/project/info/${projectId}`) {
        send(response, 200, {
          id: projectId,
          name: 'Editorial test project',
          orgId: 'local',
          defaultLocale: 'en',
          currentLocales: ['en', 'fr', 'ar'],
          autoApprove: true,
        } satisfies GetProjectInfoResponse);
        return;
      }
      if (request.method !== 'POST') {
        send(response, 404, { error: 'Unknown mock endpoint' });
        return;
      }
      if (path === '/v2/translate') {
        const parsed = runtimeRequest.parse(body);
        const result: RuntimeTranslationResponse = {};
        for (const [id, entry] of Object.entries(parsed.requests)) {
          result[id] = failedEntries.has(id)
            ? { success: false, error: 'Deterministic item failure', code: 422 }
            : {
                success: true,
                translation: render(entry.source, parsed.targetLocale),
                dataFormat: 'STRING',
                locale: parsed.targetLocale,
              };
        }
        send(response, 200, result);
      } else if (path === '/v2/project/files/upload-files') {
        const parsed = uploadRequest.parse(body);
        const uploadedFiles: UploadSourceFilesResponse['uploadedFiles'] = [];
        for (const { source } of parsed.data) {
          if (
            !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(source.content)
          )
            throw new TypeError('Expected base64 file content');
          const file = {
            ...source,
            content: Buffer.from(source.content, 'base64').toString('utf8'),
            fileId: source.fileId ?? digest(source.fileName),
            versionId: source.versionId ?? digest(source.content),
            branchId: source.branchId ?? 'main',
          };
          if (file.fileFormat === 'JSON') JSON.parse(file.content);
          files.set(key(file), file);
          uploadedFiles.push({
            fileId: file.fileId,
            versionId: file.versionId,
            branchId: file.branchId,
            fileName: file.fileName,
            fileFormat: file.fileFormat,
            locale: file.locale,
          });
        }
        send(response, 201, {
          uploadedFiles,
          count: uploadedFiles.length,
          message: 'Uploaded',
        } satisfies UploadSourceFilesResponse);
      } else if (path === '/v2/project/translations/enqueue') {
        const parsed = enqueueRequest.parse(body);
        const result: EnqueueFileTranslationsResponse = {
          jobData: {},
          locales: parsed.targetLocales,
          message: 'Queued',
        };
        for (const identity of parsed.files) {
          const file = files.get(key(identity));
          if (!file) {
            send(response, 400, { error: 'Source version was not uploaded' });
            return;
          }
          for (const locale of parsed.targetLocales) {
            const jobId = digest(`${key(file)}/${locale}`);
            if (jobs.has(jobId) && !parsed.force) continue;
            jobs.set(jobId, { jobId, file, locale });
            result.jobData[jobId] = {
              sourceFileId: file.fileId,
              fileId: file.fileId,
              versionId: file.versionId,
              branchId: file.branchId,
              targetLocale: locale,
              projectId,
              orgId: 'local',
              force: parsed.force ?? false,
            };
          }
        }
        send(response, 200, result);
      } else if (path === '/v2/project/jobs/info') {
        const parsed = jobInfoRequest.parse(body);
        const statuses: GetTranslationJobInfoResponse = parsed.jobIds.map((jobId) => {
          if (!jobs.has(jobId)) return { jobId, status: 'unknown' };
          if (state.status === 'failed')
            return { jobId, status: 'failed', error: { message: 'Deterministic job failure' } };
          return { jobId, status: state.status };
        });
        send(response, 200, statuses);
      } else if (path === '/v2/project/files/info') {
        const parsed = fileInfoRequest.parse(body);
        const result: GetFileInfoResponse = { sourceFiles: [], translatedFiles: [] };
        for (const identity of parsed.translatedFiles ?? []) {
          const file = files.get(key(identity));
          if (file)
            result.translatedFiles.push({
              ...identity,
              fileFormat: file.fileFormat,
              dataFormat: null,
              createdAt: stamp,
              updatedAt: stamp,
              approvedAt: null,
              publishedAt: null,
              completedAt: isReady(identity) ? stamp : null,
            });
        }
        for (const identity of parsed.sourceFiles ?? []) {
          const file = files.get(key(identity));
          if (file)
            result.sourceFiles.push({
              ...identity,
              fileName: file.fileName,
              fileFormat: file.fileFormat,
              dataFormat: null,
              createdAt: stamp,
              updatedAt: stamp,
              publishedAt: null,
              locales: [...jobs.values()]
                .filter((job) => key(job.file) === key(file))
                .map((job) => job.locale),
              sourceLocale: file.locale,
            });
        }
        send(response, 200, result);
      } else if (path === '/v2/project/files/download') {
        const parsed = downloadRequest.parse(body);
        const result: DownloadFilesResponse = { files: [], count: 0, pending: [] };
        for (const identity of parsed) {
          const file = files.get(key(identity));
          if (!file || !isReady(identity)) {
            result.pending?.push(identity);
            continue;
          }
          const translated =
            file.fileFormat === 'JSON'
              ? JSON.stringify(renderJson(JSON.parse(file.content), identity.locale))
              : render(file.content, identity.locale);
          result.files.push({
            ...identity,
            id: digest(`${key(file)}/${identity.locale}`),
            fileName: file.fileName,
            fileFormat: file.fileFormat,
            data: Buffer.from(translated).toString('base64'),
            metadata: {},
          });
        }
        result.count = result.files.length;
        send(response, 200, result);
      } else {
        send(response, 404, { error: 'Unknown mock endpoint' });
      }
    } catch (failure) {
      if (
        failure instanceof z.ZodError ||
        failure instanceof SyntaxError ||
        failure instanceof TypeError
      ) {
        send(response, 400, { error: 'Invalid public request shape' });
      } else {
        response.destroy(failure instanceof Error ? failure : new Error('Mock request failed'));
      }
    }
  });
  server.on('connection', (socket) => {
    const id = ++connectionId;
    connections.set(socket, id);
    options.onConnectionEvent?.({
      event: 'connection',
      at: new Date().toISOString(),
      connectionId: id,
    });
    socket.on('timeout', () =>
      options.onConnectionEvent?.({
        event: 'timeout',
        at: new Date().toISOString(),
        connectionId: id,
      })
    );
    socket.on('close', (hadError) =>
      options.onConnectionEvent?.({
        event: 'close',
        at: new Date().toISOString(),
        connectionId: id,
        hadError,
      })
    );
  });
  server.listen(options.port ?? 0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Mock server has no TCP address');
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    failNext: (failure) => {
      failures.push(failure);
    },
    failEntries: (ids) => {
      failedEntries.clear();
      ids.forEach((id) => failedEntries.add(id));
    },
    setJobStatus: (status) => {
      state.status = status;
    },
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    },
  };
};
