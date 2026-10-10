import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createGtClient,
  GtRequestError,
  resolveGtLocale,
  retryDelay,
} from '../../server/src/engine';
import { GT_API_VERSION, RETRY_BASE_MS, RETRY_MAX_MS } from '../../shared/constants';
import { segment } from './fixtures';

const config = { apiKey: 'test-key', projectId: 'test-project', baseUrl: 'https://gt.invalid' };
const request = { sourceLocale: 'en', targetLocale: 'fr', segments: [segment()] };
const mockHttp = (handler: (request: Request, body: unknown) => Response | Promise<Response>) => {
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const outgoing = new Request(input, init);
    const text = await outgoing.clone().text();
    const body: unknown = text ? JSON.parse(text) : undefined;
    return handler(outgoing, body);
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
};
const json = (value: unknown, status = 200, headers?: Record<string, string>) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
afterEach(() => vi.unstubAllGlobals());

describe('public GT transport', () => {
  it('sends runtime context through the versioned public API', async () => {
    mockHttp((outgoing, body) => {
      expect(new URL(outgoing.url).pathname).toBe('/v2/translate');
      expect(outgoing.headers.get('gt-api-version')).toBe(GT_API_VERSION);
      expect(body).toMatchObject({
        sourceLocale: 'en',
        targetLocale: 'fr',
        requests: {
          title: {
            source: 'Bank',
            metadata: { id: 'title', context: 'River bank', dataFormat: 'STRING' },
          },
        },
      });
      return json({
        title: { success: true, translation: 'Rive', dataFormat: 'STRING', locale: 'fr' },
      });
    });
    await expect(
      createGtClient(config).translate({
        ...request,
        segments: [segment('title', 'Bank', 'River bank')],
      })
    ).resolves.toEqual({ title: 'Rive' });
  });
  it('fails the batch on partial translation failure', async () => {
    mockHttp(() => json({ title: { success: false, error: 'Rejected', code: 400 } }));
    await expect(createGtClient(config).translate(request)).rejects.toBeInstanceOf(GtRequestError);
  });
  it('does not retry authentication failures inside a durable attempt', async () => {
    const fetcher = mockHttp(() => json({ error: 'bad_key', message: 'Bearer secret-token' }, 401));
    await expect(createGtClient(config).testConnection()).rejects.toMatchObject({
      diagnostic: { code: 'invalid-key' },
      retryable: false,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('honors rate-limit delay and keeps provider secrets out of diagnostics', async () => {
    const fetcher = mockHttp(() =>
      json({ error: 'rate_limit', message: 'gtx-private-key' }, 429, { 'retry-after': '7' })
    );
    await expect(createGtClient(config).translate(request)).rejects.toMatchObject({
      retryable: true,
      retryAfterMs: 7000,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('uploads ordinary UTF-8 JSON only after verifying the project source locale', async () => {
    mockHttp((outgoing, body) => {
      if (new URL(outgoing.url).pathname.startsWith('/v2/project/info/'))
        return json({
          id: 'test-project',
          name: 'Test',
          orgId: 'org',
          defaultLocale: 'en',
          currentLocales: ['fr'],
          autoApprove: false,
        });
      expect(body).toEqual({
        data: [
          {
            source: {
              content: Buffer.from('{"title":"Hello"}').toString('base64'),
              fileName: 'article.json',
              fileFormat: 'JSON',
              locale: 'en',
            },
          },
        ],
        sourceLocale: 'en',
      });
      return json(
        {
          uploadedFiles: [
            {
              fileId: 'f',
              versionId: 'v',
              branchId: 'b',
              fileName: 'article.json',
              fileFormat: 'JSON',
              locale: 'en',
            },
          ],
          count: 1,
          message: 'Uploaded',
        },
        201
      );
    });
    await expect(createGtClient(config).upload(request, 'article.json')).resolves.toEqual({
      fileId: 'f',
      versionId: 'v',
      branchId: 'b',
    });
  });
  it('refuses contextual file uploads instead of discarding context', async () => {
    const fetcher = mockHttp(() => json({}));
    await expect(
      createGtClient(config).upload(
        { ...request, segments: [segment('title', 'Hello', 'Greeting')] },
        'article.json'
      )
    ).rejects.toBeInstanceOf(GtRequestError);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not consider empty cached job lists proof of completion', async () => {
    mockHttp(() => json({ sourceFiles: [], translatedFiles: [] }));
    await expect(
      createGtClient(config).poll({ fileId: 'f', versionId: 'v', branchId: 'b' }, 'fr', [])
    ).resolves.toEqual({ status: 'pending' });
  });
  it('rejects downloads from a different version', async () => {
    mockHttp(() =>
      json({
        files: [
          {
            fileId: 'f',
            versionId: 'old',
            branchId: 'b',
            locale: 'fr',
            fileFormat: 'JSON',
            data: Buffer.from('{"title":"Bonjour"}').toString('base64'),
          },
        ],
        count: 1,
      })
    );
    await expect(
      createGtClient(config).download({ fileId: 'f', versionId: 'v', branchId: 'b' }, 'fr')
    ).rejects.toBeInstanceOf(GtRequestError);
  });
});

describe('locale and retry boundaries', () => {
  it('uses supported locale normalization and explicit mappings', () => {
    expect(resolveGtLocale('fr-FR', {})).toBe('fr');
    expect(resolveGtLocale('cms-arabic', { 'cms-arabic': 'ar' })).toBe('ar');
    expect(resolveGtLocale('en-GB', {})).toBe('en-GB');
    expect(() => resolveGtLocale('qbr', {})).toThrow();
    expect(() => resolveGtLocale('not_a_locale', {})).toThrow();
  });
  it('bounds exponential retry jitter', () => {
    expect(retryDelay(0, () => 0)).toBe(RETRY_BASE_MS / 2);
    expect(retryDelay(0, () => 1)).toBe(RETRY_BASE_MS);
    expect(retryDelay(99, () => 1)).toBe(RETRY_MAX_MS);
  });
});
