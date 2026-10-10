import { randomBytes } from 'node:crypto';
import {
  createApiClient,
  downloadFiles,
  enqueueFileTranslations,
  getFileInfo,
  getProjectInfo,
  getTranslationJobInfo,
  translate,
  uploadSourceFiles,
} from '@generaltranslation/api';
import { afterEach, describe, expect, it } from 'vitest';
import { startMockGt, type MockGtServer } from '../src/mock-gt';

const servers: MockGtServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

const setup = async () => {
  const apiKey = randomBytes(24).toString('hex');
  const server = await startMockGt({ apiKey });
  servers.push(server);
  const client = createApiClient({
    baseUrl: server.url,
    apiKey,
    projectId: 'editorial',
    apiVersion: '2026-03-06.v1',
    retryPolicy: 'none',
  });
  return { server, client, apiKey };
};

describe('recording GT service over the public HTTP contract', () => {
  it('returns project metadata using the public client', async () => {
    const { client, server, apiKey } = await setup();
    const response = await getProjectInfo({ client, path: { projectId: 'editorial' } });
    expect(response.data).toMatchObject({ id: 'editorial', defaultLocale: 'en' });
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]).toMatchObject({ method: 'GET', path: '/v2/project/info/editorial' });
    expect(JSON.stringify(server.requests)).not.toContain(apiKey);
  });

  it('returns keyed translations and records per-entry context unchanged', async () => {
    const { client, server } = await setup();
    const response = await translate({
      client,
      body: {
        sourceLocale: 'en',
        targetLocale: 'fr',
        metadata: {},
        requests: {
          title: {
            source: 'The quiet coast',
            metadata: { context: 'Article headline', dataFormat: 'STRING' },
          },
        },
      },
    });
    expect(response.data).toEqual({
      title: {
        success: true,
        translation: '[fr] The quiet coast',
        dataFormat: 'STRING',
        locale: 'fr',
      },
    });
    expect(server.requests[0]?.body).toMatchObject({
      requests: { title: { metadata: { context: 'Article headline' } } },
    });
  });

  it('reports a partial item failure without dropping successful entries', async () => {
    const { client, server } = await setup();
    server.failEntries(['bad']);
    const response = await translate({
      client,
      body: {
        sourceLocale: 'en',
        targetLocale: 'ar',
        metadata: {},
        requests: { good: { source: 'Harbor' }, bad: { source: 'Wave' } },
      },
    });
    expect(response.data?.good).toMatchObject({ success: true, translation: '[ar] Harbor' });
    expect(response.data?.bad).toMatchObject({ success: false, code: 422 });
  });

  it('returns deterministic HTTP failures once with Retry-After', async () => {
    const { client, server } = await setup();
    server.failNext({ status: 429, retryAfter: '2' });
    const failed = await getProjectInfo({ client, path: { projectId: 'editorial' } });
    expect(failed.response.status).toBe(429);
    expect(failed.response.headers.get('retry-after')).toBe('2');
    const succeeded = await getProjectInfo({ client, path: { projectId: 'editorial' } });
    expect(succeeded.response.status).toBe(200);
    expect(server.requests).toHaveLength(2);
  });

  it('rejects unauthenticated calls without recording authorization values', async () => {
    const { server } = await setup();
    const response = await fetch(`${server.url}/v2/project/info/editorial`);
    expect(response.status).toBe(401);
    expect(server.requests[0]).not.toHaveProperty('authorization');
  });

  it('uploads, queues, polls and downloads one exact JSON version', async () => {
    const { client, server } = await setup();
    server.setJobStatus('processing');
    const upload = await uploadSourceFiles({
      client,
      body: {
        sourceLocale: 'en',
        data: [
          {
            source: {
              content: Buffer.from(JSON.stringify({ title: 'Salt and stone' })).toString('base64'),
              fileName: 'article.json',
              fileFormat: 'JSON',
              locale: 'en',
            },
          },
        ],
      },
    });
    const file = upload.data?.uploadedFiles[0];
    expect(file).toBeDefined();
    if (!file) throw new Error('The upload did not return a file');
    const queued = await enqueueFileTranslations({
      client,
      body: { files: [file], targetLocales: ['fr'], sourceLocale: 'en' },
    });
    expect(queued.data).toHaveProperty('jobData');
    if (!queued.data || !('jobData' in queued.data))
      throw new Error('The enqueue response did not contain jobs');
    const jobIds = Object.keys(queued.data.jobData);
    const pending = await getTranslationJobInfo({ client, body: { jobIds } });
    expect(pending.data?.[0]?.status).toBe('processing');
    const requestedFile = {
      fileId: file.fileId,
      versionId: file.versionId,
      branchId: file.branchId,
      locale: 'fr',
    };
    const before = await downloadFiles({ client, body: [requestedFile] });
    expect(before.data?.files).toEqual([]);
    expect(before.data?.pending).toEqual([requestedFile]);
    server.setJobStatus('completed');
    const ready = await getFileInfo({ client, body: { translatedFiles: [requestedFile] } });
    expect(ready.data?.translatedFiles[0]?.completedAt).toBeTruthy();
    const download = await downloadFiles({ client, body: [requestedFile] });
    expect(Buffer.from(download.data?.files[0]?.data ?? '', 'base64').toString()).toBe(
      JSON.stringify({ title: '[fr] Salt and stone' })
    );
    const wrong = await downloadFiles({
      client,
      body: [{ ...requestedFile, versionId: 'never-uploaded' }],
    });
    expect(wrong.data?.files).toEqual([]);
  });
});

describe('adversarial recording service requests', () => {
  it.each([400, 401, 402, 403, 413, 500])(
    'returns HTTP %i without client retries',
    async (status) => {
      const { client, server } = await setup();
      server.failNext({ status });
      const response = await translate({
        client,
        body: {
          sourceLocale: 'en',
          targetLocale: 'fr',
          metadata: {},
          requests: { title: { source: 'Shore' } },
        },
      });
      expect(response.response.status).toBe(status);
      expect(server.requests).toHaveLength(1);
    }
  );
  it('keeps empty strings empty', async () => {
    const { client } = await setup();
    const response = await translate({
      client,
      body: {
        sourceLocale: 'en',
        targetLocale: 'ar',
        metadata: {},
        requests: { empty: { source: '' } },
      },
    });
    expect(response.data?.empty).toMatchObject({ success: true, translation: '' });
  });
  it('preserves unusual Unicode through HTTP', async () => {
    const { client } = await setup();
    const source = 'مرحبا café 🐚 e\u0301';
    const response = await translate({
      client,
      body: {
        sourceLocale: 'en',
        targetLocale: 'ar',
        metadata: {},
        requests: { title: { source } },
      },
    });
    expect(response.data?.title).toMatchObject({ translation: `[ar] ${source}` });
  });
  it('isolates concurrent runtime requests', async () => {
    const { client, server } = await setup();
    const responses = await Promise.all(
      ['fr', 'ar'].map((targetLocale) =>
        translate({
          client,
          body: {
            sourceLocale: 'en',
            targetLocale,
            metadata: {},
            requests: { title: { source: targetLocale } },
          },
        })
      )
    );
    expect(responses[0]?.data?.title).toMatchObject({ translation: '[fr] fr' });
    expect(responses[1]?.data?.title).toMatchObject({ translation: '[ar] ar' });
    expect(server.requests).toHaveLength(2);
  });
  it('rejects malformed JSON', async () => {
    const { server, apiKey } = await setup();
    const response = await fetch(`${server.url}/v2/translate`, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: '{',
    });
    expect(response.status).toBe(400);
  });
  it('rejects unrecognized request shapes', async () => {
    const { server, apiKey } = await setup();
    const response = await fetch(`${server.url}/v2/translate`, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'Unsupported legacy shape' }),
    });
    expect(response.status).toBe(400);
  });
  it('does not claim an unknown job completed', async () => {
    const { client } = await setup();
    expect((await getTranslationJobInfo({ client, body: { jobIds: ['not-a-job'] } })).data).toEqual(
      [{ jobId: 'not-a-job', status: 'unknown' }]
    );
  });
  it('rejects invalid base64 upload content', async () => {
    const { client } = await setup();
    const response = await uploadSourceFiles({
      client,
      body: {
        data: [
          {
            source: {
              content: 'not base64!',
              fileName: 'broken.json',
              fileFormat: 'JSON',
              locale: 'en',
            },
          },
        ],
      },
    });
    expect(response.response.status).toBe(400);
  });
  it('does not accept a source version that was never uploaded', async () => {
    const { client } = await setup();
    const response = await enqueueFileTranslations({
      client,
      body: { files: [{ fileId: 'absent', versionId: 'absent' }], targetLocales: ['fr'] },
    });
    expect(response.response.status).toBe(400);
  });
});
