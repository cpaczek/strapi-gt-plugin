import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createGtClient, GtRequestError } from '../../server/src/engine';
import {
  MAX_SOURCE_BYTES,
  REQUEST_TIMEOUT_MS,
  RUNTIME_BATCH_BYTES,
  RUNTIME_BATCH_ENTRIES,
} from '../../shared/constants';
import { segment } from './fixtures';

const config = { apiKey: 'private-test-key', projectId: 'project', baseUrl: 'https://gt.invalid' };
const reference = { fileId: 'file', versionId: 'version', branchId: 'branch' };
const request = { sourceLocale: 'en', targetLocale: 'fr', segments: [segment()] };
const project = { id: 'project', name: 'Project', defaultLocale: 'en', currentLocales: ['fr'] };
const json = (value: unknown, status = 200, headers?: Record<string, string>) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
const runtimeBody = z.object({
  requests: z.record(
    z.string(),
    z.object({
      source: z.string(),
      metadata: z.object({ context: z.string().optional(), hash: z.string() }),
    })
  ),
  targetLocale: z.string(),
});
const recordingFetch = (
  handler: (outgoing: Request, body: unknown) => Response | Promise<Response>
) => {
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const outgoing = new Request(input, init);
    const text = await outgoing.clone().text();
    const body: unknown = text ? JSON.parse(text) : undefined;
    return handler(outgoing, body);
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
};
const runtimeReply = (body: unknown) => {
  const parsed = runtimeBody.parse(body);
  return json(
    Object.fromEntries(
      Object.entries(parsed.requests).map(([id, entry]) => [
        id,
        {
          success: true,
          translation: entry.source,
          dataFormat: 'STRING',
          locale: parsed.targetLocale,
        },
      ])
    )
  );
};
const readyFile = { ...reference, locale: 'fr', completedAt: '2026-10-10T00:00:00Z' };
const downloaded = (contents = '{"title":"Bonjour"}', overrides: Record<string, unknown> = {}) => ({
  files: [
    {
      ...reference,
      locale: 'fr',
      fileFormat: 'JSON',
      data: Buffer.from(contents).toString('base64'),
      ...overrides,
    },
  ],
  count: 1,
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('runtime adversarial transport', () => {
  it('batches by count and by serialized UTF-8 byte size', async () => {
    const fetcher = recordingFetch((_outgoing, body) => {
      expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThanOrEqual(RUNTIME_BATCH_BYTES);
      expect(Object.keys(runtimeBody.parse(body).requests).length).toBeLessThanOrEqual(
        RUNTIME_BATCH_ENTRIES
      );
      return runtimeReply(body);
    });
    const segments = Array.from({ length: RUNTIME_BATCH_ENTRIES + 2 }, (_, index) =>
      segment(`field-${index}`, '世界'.repeat(35))
    );
    await expect(createGtClient(config).translate({ ...request, segments })).resolves.toEqual(
      Object.fromEntries(segments.map((entry) => [entry.id, entry.text]))
    );
    expect(fetcher.mock.calls.length).toBeGreaterThan(1);
  });
  it('splits oversized contextual text without losing Unicode or whitespace', async () => {
    const fetcher = recordingFetch((_outgoing, body) => {
      expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThanOrEqual(RUNTIME_BATCH_BYTES);
      for (const entry of Object.values(runtimeBody.parse(body).requests))
        expect(entry.metadata.context).toBe('An exact quotation');
      return runtimeReply(body);
    });
    const text = ' שלום 👩🏽‍🚀 e\u0301\n'.repeat(1200);
    await expect(
      createGtClient(config).translate({
        ...request,
        segments: [segment('long', text, 'An exact quotation')],
      })
    ).resolves.toEqual({ long: text });
    expect(fetcher.mock.calls.length).toBeGreaterThan(1);
  });
  it('does not send an empty runtime request', async () => {
    const fetcher = recordingFetch(() => json({}));
    await expect(createGtClient(config).translate({ ...request, segments: [] })).resolves.toEqual(
      {}
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects duplicate IDs, unsupported locales and oversized content before HTTP', async () => {
    const fetcher = recordingFetch(() => json({}));
    await expect(
      createGtClient(config).translate({ ...request, segments: [segment(), segment()] })
    ).rejects.toBeInstanceOf(GtRequestError);
    await expect(
      createGtClient(config).translate({ ...request, targetLocale: 'qbr' })
    ).rejects.toBeInstanceOf(GtRequestError);
    await expect(
      createGtClient(config).translate({ ...request, segments: [segment('', 'Hello')] })
    ).rejects.toBeInstanceOf(GtRequestError);
    await expect(
      createGtClient(config).translate({
        ...request,
        segments: [segment('large', 'x'.repeat(MAX_SOURCE_BYTES))],
      })
    ).rejects.toBeInstanceOf(GtRequestError);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    [{ missing: { success: true, translation: 'x', dataFormat: 'STRING', locale: 'fr' } }],
    [{ title: { success: true, translation: 'x', dataFormat: 'STRING', locale: 'de' } }],
    [{ title: { success: true, translation: { text: 'x' }, dataFormat: 'STRING', locale: 'fr' } }],
    [{ title: { success: true, translation: 'x', dataFormat: 'JSX', locale: 'fr' } }],
    [{}],
    [
      {
        title: { success: true, translation: 'x', dataFormat: 'STRING', locale: 'fr' },
        extra: { success: true, translation: 'y', dataFormat: 'STRING', locale: 'fr' },
      },
    ],
  ])('rejects mismatched or malformed runtime results %#', async (body) => {
    recordingFetch(() => json(body));
    await expect(createGtClient(config).translate(request)).rejects.toMatchObject({
      retryable: false,
    });
  });
  it.each([
    [400, false, 'provider-failure'],
    [401, false, 'invalid-key'],
    [402, false, 'quota-exhausted'],
    [403, false, 'permission-denied'],
    [404, false, 'provider-failure'],
    [413, false, 'provider-failure'],
    [425, true, 'provider-failure'],
    [429, true, 'provider-failure'],
    [503, true, 'provider-failure'],
  ])('classifies HTTP %i and never retries internally', async (status, retryable, code) => {
    const fetcher = recordingFetch(() =>
      json({ error: 'provider', message: config.apiKey }, status)
    );
    try {
      await createGtClient(config).translate(request);
      throw new Error('Expected failure');
    } catch (failure) {
      expect(failure).toBeInstanceOf(GtRequestError);
      if (!(failure instanceof GtRequestError)) throw failure;
      expect(failure.retryable).toBe(retryable);
      expect(failure.diagnostic.code).toBe(code);
      expect(JSON.stringify(failure.diagnostic)).not.toContain(config.apiKey);
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('handles Retry-After dates and invalid values', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-10T00:00:00Z'));
    recordingFetch(() => json({}, 429, { 'retry-after': 'Sat, 10 Oct 2026 00:00:09 GMT' }));
    await expect(createGtClient(config).translate(request)).rejects.toMatchObject({
      retryAfterMs: 9000,
    });
    recordingFetch(() => json({}, 429, { 'retry-after': 'invalid' }));
    await expect(createGtClient(config).translate(request)).rejects.toMatchObject({
      retryAfterMs: undefined,
    });
  });
  it('sanitizes transport errors and keeps them retryable', async () => {
    const fetcher = recordingFetch(() => {
      throw new Error(`Network failed: ${config.apiKey}`);
    });
    await expect(createGtClient(config).translate(request)).rejects.toMatchObject({
      retryable: true,
      diagnostic: { code: 'network-failure' },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('bounds stalled requests using the configured timeout signal', async () => {
    vi.useFakeTimers();
    recordingFetch(
      (outgoing) =>
        new Promise<Response>((_resolve, reject) => {
          outgoing.signal.addEventListener('abort', () => reject(outgoing.signal.reason), {
            once: true,
          });
        })
    );
    const failed = expect(createGtClient(config).translate(request)).rejects.toMatchObject({
      retryable: true,
    });
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 1);
    await failed;
  });
  it('keeps concurrent requests independent', async () => {
    recordingFetch((_outgoing, body) => runtimeReply(body));
    const client = createGtClient(config);
    await expect(
      Promise.all(
        ['A', 'B', 'C'].map((text) =>
          client.translate({ ...request, segments: [segment('same-id', text)] })
        )
      )
    ).resolves.toEqual([{ 'same-id': 'A' }, { 'same-id': 'B' }, { 'same-id': 'C' }]);
  });
  it('changes the request hash with context and locale', async () => {
    const hashes: string[] = [];
    recordingFetch((_outgoing, body) => {
      const parsed = runtimeBody.parse(body);
      const entry = parsed.requests.title;
      if (entry) hashes.push(entry.metadata.hash);
      return runtimeReply(body);
    });
    const client = createGtClient(config);
    await client.translate(request);
    await client.translate({ ...request, targetLocale: 'ar' });
    await client.translate({ ...request, segments: [segment('title', 'Hello', 'Greeting')] });
    expect(new Set(hashes).size).toBe(3);
  });
  it('requires server configuration and rejects credentials embedded in URLs', () => {
    expect(() => createGtClient({ ...config, apiKey: '' })).toThrow();
    expect(() => createGtClient({ ...config, projectId: '' })).toThrow();
    expect(() => createGtClient({ ...config, baseUrl: 'https://user:pass@gt.invalid' })).toThrow();
    expect(() => createGtClient({ ...config, baseUrl: 'file:///private' })).toThrow();
  });
});

describe('file lifecycle adversarial transport', () => {
  it('refuses source-locale mismatch without uploading', async () => {
    const fetcher = recordingFetch(() => json({ ...project, defaultLocale: 'de' }));
    await expect(createGtClient(config).upload(request, 'entry.json')).rejects.toMatchObject({
      diagnostic: { code: 'source-locale-mismatch' },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects a different project identity', async () => {
    recordingFetch(() => json({ ...project, id: 'other' }));
    await expect(createGtClient(config).testConnection()).rejects.toMatchObject({
      retryable: false,
    });
  });
  it.each([
    { uploadedFiles: [], count: 0 },
    { uploadedFiles: [{ ...reference, fileName: 'wrong.json', fileFormat: 'JSON' }], count: 1 },
    { uploadedFiles: [{ ...reference, fileName: 'entry.json', fileFormat: 'JSON' }], count: 2 },
  ])('rejects incomplete or incorrect uploaded references %#', async (response) => {
    recordingFetch((outgoing) => json(outgoing.method === 'GET' ? project : response));
    await expect(createGtClient(config).upload(request, 'entry.json')).rejects.toMatchObject({
      retryable: false,
    });
  });
  it('enqueues exact references and permits an empty cache-hit job list', async () => {
    recordingFetch((_outgoing, body) => {
      expect(body).toEqual({
        files: [reference],
        sourceLocale: 'en',
        targetLocales: ['fr'],
        force: true,
      });
      return json({ jobData: {} });
    });
    await expect(createGtClient(config).enqueue(reference, request, true)).resolves.toEqual([]);
  });
  it('validates every queued job binding', async () => {
    recordingFetch(() =>
      json({ jobData: { job: { ...reference, targetLocale: 'fr', projectId: 'project' } } })
    );
    await expect(createGtClient(config).enqueue(reference, request, false)).resolves.toEqual([
      'job',
    ]);
    recordingFetch(() =>
      json({
        jobData: {
          job: { ...reference, versionId: 'other', targetLocale: 'fr', projectId: 'project' },
        },
      })
    );
    await expect(createGtClient(config).enqueue(reference, request, false)).rejects.toMatchObject({
      retryable: false,
    });
  });
  it.each(['queued', 'processing'])(
    'returns pending for %s jobs without a readiness read',
    async (status) => {
      const fetcher = recordingFetch(() => json([{ jobId: 'job', status }]));
      await expect(createGtClient(config).poll(reference, 'fr', ['job'])).resolves.toEqual({
        status: 'pending',
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  );
  it.each(['failed', 'unknown'])('returns an actionable failure for %s jobs', async (status) => {
    recordingFetch(() => json([{ jobId: 'job', status }]));
    await expect(createGtClient(config).poll(reference, 'fr', ['job'])).resolves.toMatchObject({
      status: 'failed',
      message: { code: 'provider-failure' },
    });
  });
  it.each([
    { response: [] },
    { response: [{ jobId: 'other', status: 'completed' }] },
    {
      response: [
        { jobId: 'job', status: 'completed' },
        { jobId: 'job', status: 'completed' },
      ],
    },
  ])('rejects missing or duplicate job statuses %#', async ({ response }) => {
    recordingFetch(() => json(response));
    await expect(createGtClient(config).poll(reference, 'fr', ['job'])).rejects.toMatchObject({
      retryable: false,
    });
  });
  it('requires exact-version completion after jobs finish', async () => {
    recordingFetch((outgoing, body) => {
      if (outgoing.url.endsWith('/jobs/info')) return json([{ jobId: 'job', status: 'completed' }]);
      expect(body).toEqual({ translatedFiles: [{ ...reference, locale: 'fr' }] });
      return json({ translatedFiles: [readyFile] });
    });
    await expect(createGtClient(config).poll(reference, 'fr', ['job'])).resolves.toEqual({
      status: 'ready',
    });
  });
  it('requires a completion timestamp for a cached file version', async () => {
    recordingFetch(() => json({ translatedFiles: [{ ...readyFile, completedAt: null }] }));
    await expect(createGtClient(config).poll(reference, 'fr', [])).resolves.toEqual({
      status: 'pending',
    });
  });
  it.each([
    { translatedFiles: [{ ...readyFile, versionId: 'old' }] },
    { translatedFiles: [readyFile, readyFile] },
  ])('rejects wrong or duplicate readiness references %#', async ({ translatedFiles }) => {
    recordingFetch(() => json({ translatedFiles }));
    await expect(createGtClient(config).poll(reference, 'fr', [])).rejects.toMatchObject({
      retryable: false,
    });
  });
  it('downloads exactly the recorded version with no latest-version fallback', async () => {
    recordingFetch((_outgoing, body) => {
      expect(body).toEqual([{ ...reference, locale: 'fr', useLatestAvailableVersion: false }]);
      return json(downloaded());
    });
    await expect(createGtClient(config).download(reference, 'fr')).resolves.toEqual({
      title: 'Bonjour',
    });
  });
  it('treats a pending download as retryable', async () => {
    recordingFetch(() => json({ files: [], count: 0, pending: [{ ...reference, locale: 'fr' }] }));
    await expect(createGtClient(config).download(reference, 'fr')).rejects.toMatchObject({
      retryable: true,
    });
  });
  it.each([
    downloaded('', { data: 'not_base64' }),
    downloaded('not-json'),
    downloaded('{"title":5}'),
    downloaded('', { data: Buffer.from([0xff, 0xfe]).toString('base64') }),
    { files: [], count: 0 },
    downloaded('{"title":"Bonjour"}', { locale: 'de' }),
  ])('rejects corrupt or mismatched downloaded content %#', async (response) => {
    recordingFetch(() => json(response));
    await expect(createGtClient(config).download(reference, 'fr')).rejects.toMatchObject({
      retryable: false,
    });
  });
  it('rejects downloaded content above the local size limit', async () => {
    recordingFetch(() => json(downloaded(JSON.stringify({ title: 'x'.repeat(MAX_SOURCE_BYTES) }))));
    await expect(createGtClient(config).download(reference, 'fr')).rejects.toMatchObject({
      retryable: false,
    });
  });
});

describe('runtime size and status boundaries', () => {
  it('rejects context that leaves no room for source text', async () => {
    const fetcher = recordingFetch(() => json({}));
    await expect(
      createGtClient(config).translate({
        ...request,
        segments: [segment('title', 'Hello', 'x'.repeat(RUNTIME_BATCH_BYTES))],
      })
    ).rejects.toMatchObject({ retryable: false });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects a single grapheme larger than the payload budget', async () => {
    const fetcher = recordingFetch(() => json({}));
    await expect(
      createGtClient(config).translate({
        ...request,
        segments: [segment('title', `a${'\u0301'.repeat(RUNTIME_BATCH_BYTES)}`, 'Grapheme')],
      })
    ).rejects.toMatchObject({ retryable: false });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('returns an empty text locally without paying for a runtime call', async () => {
    const fetcher = recordingFetch(() => json({}));
    await expect(
      createGtClient(config).translate({ ...request, segments: [segment('title', '')] })
    ).resolves.toEqual({ title: '' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('handles a public ApiError raised by the transport', async () => {
    const { ApiError } = await import('@generaltranslation/api');
    recordingFetch(() => {
      throw new ApiError('auth', 401, 'Do not expose');
    });
    await expect(createGtClient(config).translate(request)).rejects.toMatchObject({
      retryable: false,
      diagnostic: { code: 'invalid-key' },
    });
  });
});
