import { createServer } from 'node:http';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createGtClient } from '../../server/src/engine';
import { GT_API_VERSION } from '../../shared/constants';
import { segment } from './fixtures';

const runtimeRequest = z.object({
  requests: z.record(
    z.string(),
    z.object({ source: z.string(), metadata: z.object({ context: z.string().optional() }) })
  ),
});

describe('recording HTTP integration through the public GT client', () => {
  it('records runtime and persisted file stages across fresh adapter instances', async () => {
    const reference = { fileId: 'file', versionId: 'version', branchId: 'branch' };
    const records: {
      path: string;
      method: string;
      version: string | string[] | undefined;
      body: unknown;
    }[] = [];
    const server = createServer(async (incoming, outgoing) => {
      const chunks: Buffer[] = [];
      for await (const chunk of incoming) {
        const value: unknown = chunk;
        if (Buffer.isBuffer(value)) chunks.push(value);
      }
      const text = Buffer.concat(chunks).toString('utf8');
      const body: unknown = text ? JSON.parse(text) : null;
      const path = incoming.url ?? '';
      records.push({
        path,
        method: incoming.method ?? '',
        version: incoming.headers['gt-api-version'],
        body,
      });
      outgoing.setHeader('content-type', 'application/json');
      if (path === '/v2/translate') {
        const parsed = runtimeRequest.parse(body);
        outgoing.end(
          JSON.stringify(
            Object.fromEntries(
              Object.entries(parsed.requests).map(([id, entry]) => [
                id,
                {
                  success: true,
                  translation: `French: ${entry.source}`,
                  dataFormat: 'STRING',
                  locale: 'fr',
                },
              ])
            )
          )
        );
      } else if (path === '/v2/project/info/project')
        outgoing.end(
          JSON.stringify({
            id: 'project',
            name: 'Project',
            defaultLocale: 'en',
            currentLocales: ['fr'],
          })
        );
      else if (path === '/v2/project/files/upload-files') {
        outgoing.statusCode = 201;
        outgoing.end(
          JSON.stringify({
            uploadedFiles: [{ ...reference, fileName: 'entry.json', fileFormat: 'JSON' }],
            count: 1,
          })
        );
      } else if (path === '/v2/project/translations/enqueue')
        outgoing.end(
          JSON.stringify({
            jobData: { job: { ...reference, targetLocale: 'fr', projectId: 'project' } },
          })
        );
      else if (path === '/v2/project/jobs/info')
        outgoing.end(JSON.stringify([{ jobId: 'job', status: 'completed' }]));
      else if (path === '/v2/project/files/info')
        outgoing.end(
          JSON.stringify({
            translatedFiles: [{ ...reference, locale: 'fr', completedAt: '2026-10-10T00:00:00Z' }],
          })
        );
      else if (path === '/v2/project/files/download')
        outgoing.end(
          JSON.stringify({
            files: [
              {
                ...reference,
                locale: 'fr',
                fileFormat: 'JSON',
                data: Buffer.from('{"title":"Bonjour"}').toString('base64'),
              },
            ],
            count: 1,
          })
        );
      else {
        outgoing.statusCode = 404;
        outgoing.end('{}');
      }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP test listener');
    const config = {
      apiKey: 'recording-test-key',
      projectId: 'project',
      baseUrl: `http://127.0.0.1:${address.port}`,
    };
    const request = { sourceLocale: 'en', targetLocale: 'fr', segments: [segment()] };
    try {
      await expect(
        createGtClient(config).translate({
          ...request,
          segments: [segment('greeting', 'Hello', 'A greeting')],
        })
      ).resolves.toEqual({ greeting: 'French: Hello' });
      const uploaded = await createGtClient(config).upload(request, 'entry.json');
      const persisted = JSON.parse(JSON.stringify(uploaded));
      const checked = z
        .object({ fileId: z.string(), versionId: z.string(), branchId: z.string() })
        .parse(persisted);
      const jobs = await createGtClient(config).enqueue(checked, request, false);
      await expect(createGtClient(config).poll(checked, 'fr', jobs)).resolves.toEqual({
        status: 'ready',
      });
      await expect(createGtClient(config).download(checked, 'fr')).resolves.toEqual({
        title: 'Bonjour',
      });
      expect(records.map((entry) => entry.path)).toEqual([
        '/v2/translate',
        '/v2/project/info/project',
        '/v2/project/files/upload-files',
        '/v2/project/translations/enqueue',
        '/v2/project/jobs/info',
        '/v2/project/files/info',
        '/v2/project/files/download',
      ]);
      expect(records.every((entry) => entry.version === GT_API_VERSION)).toBe(true);
      expect(records[0]?.body).toMatchObject({
        requests: { greeting: { metadata: { context: 'A greeting' } } },
      });
      expect(records[2]?.body).toEqual({
        data: [
          {
            source: {
              fileName: 'entry.json',
              fileFormat: 'JSON',
              locale: 'en',
              content: Buffer.from('{"title":"Hello"}').toString('base64'),
            },
          },
        ],
        sourceLocale: 'en',
      });
      expect(records[6]?.body).toEqual([
        { ...reference, locale: 'fr', useLatestAvailableVersion: false },
      ]);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((failure) => (failure ? reject(failure) : resolve()))
      );
    }
  });
});
