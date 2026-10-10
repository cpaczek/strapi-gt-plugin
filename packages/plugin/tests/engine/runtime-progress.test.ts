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

describe('runtime checkpoint adversarial boundaries', () => {
  it('does not resend fully completed chunks after a process restart', async () => {
    const fetcher = stubRuntime((body) => json(success(body)));
    let completed: Record<string, string> = {};
    const onProgress = async (next: Record<string, string>) => {
      completed = structuredClone(next);
    };
    const expected = await createGtClient(configuration).translate(request, {
      completed,
      onProgress,
    });
    const calls = fetcher.mock.calls.length;
    const resumed = await createGtClient(configuration).translate(request, {
      completed,
      onProgress,
    });
    expect(resumed).toEqual(expected);
    expect(fetcher).toHaveBeenCalledTimes(calls);
  });
  it('keeps checkpoint identity stable across segment and object-key reordering', async () => {
    const fetcher = stubRuntime((body) => json(success(body)));
    let completed: Record<string, string> = {};
    const onProgress = async (next: Record<string, string>) => {
      completed = structuredClone(next);
    };
    const expected = await createGtClient(configuration).translate(request, {
      completed,
      onProgress,
    });
    const calls = fetcher.mock.calls.length;
    await expect(
      createGtClient(configuration).translate(
        { ...request, segments: [...request.segments].reverse() },
        { completed: Object.fromEntries(Object.entries(completed).reverse()), onProgress }
      )
    ).resolves.toEqual(expected);
    expect(fetcher).toHaveBeenCalledTimes(calls);
  });
  it.each(['text', 'context', 'locale', 'project', 'path'])(
    'rejects checkpoints from a changed %s before HTTP',
    async (changed) => {
      const fetcher = stubRuntime((body) => json(success(body)));
      let completed: Record<string, string> = {};
      const onProgress = async (next: Record<string, string>) => {
        completed = structuredClone(next);
      };
      const initial = { ...request, segments: [segment('title', 'Bank', 'River')] };
      await createGtClient(configuration).translate(initial, { completed, onProgress });
      const updated = {
        ...initial,
        targetLocale: changed === 'locale' ? 'ar' : 'fr',
        segments: [
          segment(
            'title',
            changed === 'text' ? 'New text' : 'Bank',
            changed === 'context' ? 'Finance' : 'River'
          ),
        ],
      };
      if (changed === 'path' && updated.segments[0]) updated.segments[0].path = ['different'];
      await expect(
        createGtClient({
          ...configuration,
          projectId: changed === 'project' ? 'other' : configuration.projectId,
        }).translate(updated, { completed, onProgress })
      ).rejects.toMatchObject({ acceptance: 'not-sent', retryable: false });
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  );
  it('rejects unknown keys and invalid checkpoint value types before HTTP', async () => {
    const fetcher = stubRuntime((body) => json(success(body)));
    const onProgress = vi.fn(async () => {});
    await expect(
      createGtClient(configuration).translate(request, {
        completed: { unknown: 'Text' },
        onProgress,
      })
    ).rejects.toMatchObject({ acceptance: 'not-sent' });
    const invalid: Record<string, string> = {};
    Object.defineProperty(invalid, 'bad', { value: 5, enumerable: true });
    await expect(
      createGtClient(configuration).translate(request, { completed: invalid, onProgress })
    ).rejects.toMatchObject({ acceptance: 'not-sent' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('resumes split RTL and grapheme-rich fields without retranslating completed chunks', async () => {
    const text = ' العربية 👩🏽‍🚀 e\u0301\n'.repeat(1500);
    const large = { ...request, segments: [segment('large', text, 'Quotation')] };
    const sent: string[][] = [];
    let calls = 0;
    stubRuntime((body) => {
      calls += 1;
      sent.push(Object.keys(runtimeSchema.parse(body).requests));
      return calls === 2 ? json({ error: 'rate-limit' }, 429) : json(success(body));
    });
    let completed: Record<string, string> = {};
    const onProgress = async (next: Record<string, string>) => {
      completed = structuredClone(next);
    };
    await expect(
      createGtClient(configuration).translate(large, { completed, onProgress })
    ).rejects.toMatchObject({ acceptance: 'rejected' });
    const first = sent[0];
    await expect(
      createGtClient(configuration).translate(large, { completed, onProgress })
    ).resolves.toEqual({ large: text });
    expect(sent.filter((ids) => JSON.stringify(ids) === JSON.stringify(first))).toHaveLength(1);
  });
  it('keeps caller-owned checkpoints and callback snapshots separate from reconstruction', async () => {
    stubRuntime((body) => json(success(body)));
    const completed: Record<string, string> = {};
    const onProgress = async (next: Record<string, string>) => {
      for (const key of Object.keys(next)) next[key] = 'Mutated callback';
    };
    await expect(
      createGtClient(configuration).translate(
        { ...request, segments: [segment('title', 'Hello')] },
        { completed, onProgress }
      )
    ).resolves.toEqual({ title: 'Hello' });
    expect(completed).toEqual({});
  });
  it('persists valid successes beside malformed items and fails uncertain', async () => {
    stubRuntime(() =>
      json({
        first: { success: true, translation: 'Saved', dataFormat: 'STRING', locale: 'fr' },
        second: { success: true, translation: 4, dataFormat: 'STRING', locale: 'fr' },
      })
    );
    let completed: Record<string, string> = {};
    await expect(
      createGtClient(configuration).translate(
        { ...request, segments: [segment('first'), segment('second')] },
        {
          completed,
          onProgress: async (next) => {
            completed = next;
          },
        }
      )
    ).rejects.toMatchObject({ acceptance: 'unknown', retryable: false });
    expect(Object.values(completed)).toEqual(['Saved']);
  });
  it('never checkpoints unexpected provider IDs', async () => {
    stubRuntime((body) =>
      json({
        ...success(body),
        unexpected: {
          success: true,
          translation: 'Unrequested',
          dataFormat: 'STRING',
          locale: 'fr',
        },
      })
    );
    let completed: Record<string, string> = {};
    await expect(
      createGtClient(configuration).translate(
        { ...request, segments: [segment()] },
        {
          completed,
          onProgress: async (next) => {
            completed = next;
          },
        }
      )
    ).rejects.toMatchObject({ acceptance: 'unknown' });
    expect(Object.values(completed)).toEqual(['Hello']);
  });
  it('retains validated successes regardless of the order of per-item failures', async () => {
    stubRuntime(() =>
      json({
        first: { success: false, code: 503, error: 'Try later' },
        second: { success: true, translation: 'Saved', dataFormat: 'STRING', locale: 'fr' },
      })
    );
    let completed: Record<string, string> = {};
    await expect(
      createGtClient(configuration).translate(
        { ...request, segments: [segment('first'), segment('second')] },
        {
          completed,
          onProgress: async (next) => {
            completed = next;
          },
        }
      )
    ).rejects.toMatchObject({ acceptance: 'rejected', httpStatus: 503, retryable: true });
    expect(Object.values(completed)).toEqual(['Saved']);
  });
  it('prioritizes a permanent rejection over another item that can retry', async () => {
    stubRuntime(() =>
      json({
        first: { success: false, code: 429, error: 'Wait' },
        second: { success: false, code: 401, error: 'Key' },
      })
    );
    await expect(
      createGtClient(configuration).translate(
        { ...request, segments: [segment('first'), segment('second')] },
        { completed: {}, onProgress: async () => {} }
      )
    ).rejects.toMatchObject({ acceptance: 'rejected', httpStatus: 401, retryable: false });
  });
  it('runs concurrent checkpointed requests without sharing progress', async () => {
    stubRuntime((body) => json(success(body)));
    const snapshots: Record<string, string>[] = [];
    const results = await Promise.all(
      ['One', 'Two'].map((text) =>
        createGtClient(configuration).translate(
          { ...request, segments: [segment('same', text)] },
          {
            completed: {},
            onProgress: async (next) => {
              snapshots.push(next);
            },
          }
        )
      )
    );
    expect(results).toEqual([{ same: 'One' }, { same: 'Two' }]);
    expect(new Set(snapshots.flatMap(Object.keys)).size).toBe(2);
  });
  it('performs no remote or progress work for an empty request', async () => {
    const fetcher = stubRuntime((body) => json(success(body)));
    const onProgress = vi.fn(async () => {});
    await expect(
      createGtClient(configuration).translate(
        { ...request, segments: [] },
        { completed: {}, onProgress }
      )
    ).resolves.toEqual({});
    expect(fetcher).not.toHaveBeenCalled();
    expect(onProgress).not.toHaveBeenCalled();
  });
});

describe('paid request acceptance semantics', () => {
  const reference = { fileId: 'file', versionId: 'version', branchId: 'branch' };
  it.each([408, 500, 503])(
    'treats HTTP %i as uncertain for both paid operations',
    async (status) => {
      stubRuntime(() => json({ error: 'Request failed' }, status));
      await expect(createGtClient(configuration).translate(request)).rejects.toMatchObject({
        acceptance: 'unknown',
        httpStatus: status,
        retryable: false,
        diagnostic: { code: 'interrupted-request' },
      });
      await expect(
        createGtClient(configuration).enqueue(reference, request, false)
      ).rejects.toMatchObject({ acceptance: 'unknown', httpStatus: status, retryable: false });
    }
  );
  it.each([425, 429])(
    'treats HTTP %i as an explicit rejection for paid operations',
    async (status) => {
      stubRuntime(() => json({ error: 'Wait' }, status));
      await expect(
        createGtClient(configuration).enqueue(reference, request, false)
      ).rejects.toMatchObject({ acceptance: 'rejected', httpStatus: status, retryable: true });
    }
  );
  it('marks an enqueue transport failure uncertain and does not leak failure details', async () => {
    stubRuntime(() => {
      throw new Error(configuration.apiKey);
    });
    await expect(
      createGtClient(configuration).enqueue(reference, request, false)
    ).rejects.toMatchObject({
      acceptance: 'unknown',
      retryable: false,
      diagnostic: { code: 'interrupted-request' },
    });
  });
  it('marks malformed accepted enqueue responses uncertain', async () => {
    stubRuntime(() => json({ invalid: 'result' }));
    await expect(
      createGtClient(configuration).enqueue(reference, request, false)
    ).rejects.toMatchObject({ acceptance: 'unknown', retryable: false });
  });
  it('keeps polling and download transport failures retryable', async () => {
    stubRuntime(() => {
      throw new Error('Disconnected');
    });
    await expect(
      createGtClient(configuration).poll(reference, 'fr', ['job'])
    ).rejects.toMatchObject({
      acceptance: 'unknown',
      retryable: true,
      diagnostic: { code: 'network-failure' },
    });
    await expect(createGtClient(configuration).download(reference, 'fr')).rejects.toMatchObject({
      acceptance: 'unknown',
      retryable: true,
    });
  });
});
