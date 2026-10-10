import { createServer } from 'node:http';
import { once } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createGtClient } from '../../server/src/engine';
import type { GtTranslationRequest } from '../../shared/contracts';
import { segment } from './fixtures';

const runtimeSchema = z.object({
  requests: z.record(z.string(), z.object({ source: z.string() })),
  targetLocale: z.string(),
});
const configuration = {
  apiKey: 'checkpoint-test-key',
  projectId: 'project',
  baseUrl: 'https://gt.invalid',
};
const request: GtTranslationRequest = {
  sourceLocale: 'en',
  targetLocale: 'fr',
  segments: [segment('first', 'A'.repeat(4500)), segment('second', 'B'.repeat(4500))],
};
const success = (body: unknown) => {
  const parsed = runtimeSchema.parse(body);
  return Object.fromEntries(
    Object.entries(parsed.requests).map(([id, entry]) => [
      id,
      {
        success: true,
        translation: entry.source,
        dataFormat: 'STRING',
        locale: parsed.targetLocale,
      },
    ])
  );
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const stubRuntime = (handler: (body: unknown) => Response | Promise<Response>) => {
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const outgoing = new Request(input, init);
    const body: unknown = JSON.parse(await outgoing.text());
    return handler(body);
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
};
const startRecordingServer = async (
  handler: (body: unknown, index: number) => { status: number; body: unknown } | 'disconnect'
) => {
  const records: unknown[] = [];
  const server = createServer(async (incoming, outgoing) => {
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) {
      const bytes: unknown = chunk;
      if (Buffer.isBuffer(bytes)) chunks.push(bytes);
    }
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    records.push(body);
    const response = handler(body, records.length);
    if (response === 'disconnect') incoming.socket.destroy();
    else {
      outgoing.writeHead(response.status, { 'content-type': 'application/json' });
      outgoing.end(JSON.stringify(response.body));
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected loopback test listener');
  return {
    config: { ...configuration, baseUrl: `http://127.0.0.1:${address.port}` },
    records,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((failure) => (failure ? reject(failure) : resolve()))
      ),
  };
};
afterEach(() => vi.unstubAllGlobals());

describe('durable runtime progress', () => {
  it('persists the first batch before a second-batch 429 and resumes only missing text', async () => {
    const server = await startRecordingServer((body, index) =>
      index === 2
        ? { status: 429, body: { error: 'rate-limit' } }
        : { status: 200, body: success(body) }
    );
    let completed: Record<string, string> = {};
    const onProgress = vi.fn(async (next: Record<string, string>) => {
      completed = structuredClone(next);
    });
    try {
      await expect(
        createGtClient(server.config).translate(request, { completed, onProgress })
      ).rejects.toMatchObject({ acceptance: 'rejected', httpStatus: 429, retryable: true });
      expect(Object.keys(completed)).toHaveLength(1);
      await expect(
        createGtClient(server.config).translate(request, { completed, onProgress })
      ).resolves.toEqual({ first: request.segments[0]?.text, second: request.segments[1]?.text });
      expect(server.records.map((body) => Object.keys(runtimeSchema.parse(body).requests))).toEqual(
        [['first'], ['second'], ['second']]
      );
      expect(onProgress).toHaveBeenCalledTimes(2);
    } finally {
      await server.close();
    }
  });
  it('treats a dropped paid response as uncertain and preserves earlier checkpoints for manual retry', async () => {
    const server = await startRecordingServer((body, index) =>
      index === 2 ? 'disconnect' : { status: 200, body: success(body) }
    );
    let completed: Record<string, string> = {};
    const onProgress = async (next: Record<string, string>) => {
      completed = structuredClone(next);
    };
    try {
      await expect(
        createGtClient(server.config).translate(request, { completed, onProgress })
      ).rejects.toMatchObject({
        acceptance: 'unknown',
        retryable: false,
        diagnostic: { code: 'interrupted-request' },
      });
      expect(server.records).toHaveLength(2);
      expect(Object.keys(completed)).toHaveLength(1);
      await expect(
        createGtClient(server.config).translate(request, { completed, onProgress })
      ).resolves.toEqual({ first: request.segments[0]?.text, second: request.segments[1]?.text });
      expect(server.records.map((body) => Object.keys(runtimeSchema.parse(body).requests))).toEqual(
        [['first'], ['second'], ['second']]
      );
    } finally {
      await server.close();
    }
  });
  it('checkpoints partial successes before rejecting a per-entry failure', async () => {
    const entries = {
      ...request,
      segments: [segment('first', 'Hello'), segment('second', 'World')],
    };
    let calls = 0;
    const fetcher = stubRuntime((body) => {
      calls += 1;
      return json(
        calls === 1
          ? {
              first: { success: true, translation: 'Bonjour', dataFormat: 'STRING', locale: 'fr' },
              second: { success: false, error: 'Slow down', code: 429 },
            }
          : success(body)
      );
    });
    let completed: Record<string, string> = {};
    const onProgress = async (next: Record<string, string>) => {
      completed = structuredClone(next);
    };
    await expect(
      createGtClient(configuration).translate(entries, { completed, onProgress })
    ).rejects.toMatchObject({ acceptance: 'rejected', httpStatus: 429, retryable: true });
    expect(Object.values(completed)).toEqual(['Bonjour']);
    await expect(
      createGtClient(configuration).translate(entries, { completed, onProgress })
    ).resolves.toEqual({ first: 'Bonjour', second: 'World' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('stops before another remote batch when the accepted result cannot be persisted', async () => {
    const fetcher = stubRuntime((body) => json(success(body)));
    const onProgress = vi.fn(async () => {
      throw new Error('The lease was lost');
    });
    await expect(
      createGtClient(configuration).translate(request, { completed: {}, onProgress })
    ).rejects.toMatchObject({
      acceptance: 'unknown',
      retryable: false,
      diagnostic: { code: 'interrupted-request' },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('waits for durable persistence before sending another batch', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started: (() => void) | undefined;
    const persisted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const fetcher = stubRuntime((body) => json(success(body)));
    const onProgress = vi.fn(async () => {
      started?.();
      await gate;
    });
    const translation = createGtClient(configuration).translate(request, {
      completed: {},
      onProgress,
    });
    await Promise.race([persisted, translation]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    release?.();
    await translation;
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
