import { once } from 'node:events';
import { Worker } from 'node:worker_threads';
import { request, type APIRequestContext } from '@playwright/test';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createEditorApi } from '../src/editor-api';

const eventSchema = z.object({
  event: z.enum(['listening', 'request', 'finish', 'blocking', 'timeout']),
  port: z.number().optional(),
  idleDeadlineMs: z.number().optional(),
  time: z.number().optional(),
  path: z.string().optional(),
  connectionId: z.number().optional(),
});
type ServerEvent = z.infer<typeof eventSchema>;

const withApi = async (
  pooled: boolean,
  run: (
    api: APIRequestContext,
    worker: Worker,
    events: ServerEvent[],
    idleDeadlineMs: number
  ) => Promise<void>
): Promise<void> => {
  const worker = new Worker(new URL('../src/idle-api-server.mjs', import.meta.url));
  const events: ServerEvent[] = [];
  worker.on('message', (message: unknown) => events.push(eventSchema.parse(message)));
  const [message] = await once(worker, 'message');
  const ready = eventSchema.parse(message);
  if (!ready.port || !ready.idleDeadlineMs) throw new Error('Idle API server did not start');
  const origin = `http://127.0.0.1:${ready.port}`;
  const api = pooled
    ? await request.newContext({ baseURL: origin })
    : await createEditorApi(origin, 'synthetic-test-token');
  try {
    await run(api, worker, events, ready.idleDeadlineMs);
  } finally {
    await api.dispose();
    worker.postMessage({ event: 'close' });
    await once(worker, 'exit');
  }
};

const crossIdleDeadline = async (
  api: APIRequestContext,
  worker: Worker,
  events: ServerEvent[],
  idleDeadlineMs: number
): ReturnType<APIRequestContext['get']> => {
  expect((await api.get('/warm')).status()).toBe(200);
  expect((await api.get('/warm-again')).status()).toBe(200);
  while (events.filter((event) => event.event === 'finish').length < 2)
    await once(worker, 'message');
  const completed = events.filter((event) => event.event === 'finish').at(-1)?.time;
  if (completed === undefined)
    throw new Error('The API server did not report its response deadline');
  const blocking = once(worker, 'message');
  worker.postMessage({ event: 'block', until: completed + idleDeadlineMs + 150 });
  const [barrier] = await blocking;
  expect(eventSchema.parse(barrier).event).toBe('blocking');
  // Queue the request during the observed block; the server processes it after its idle deadline.
  return api.get('/after-idle');
};

describe('editor API transport', () => {
  it('completes a request when Strapi is busy across a prior socket idle deadline', async () => {
    await withApi(false, async (api, worker, events, deadline) => {
      expect((await crossIdleDeadline(api, worker, events, deadline)).status()).toBe(200);
      expect(
        events.filter((event) => event.event === 'request').map((event) => event.connectionId)
      ).toEqual([1, 2, 3]);
    });
  }, 15000);

  it('reproduces the reset for the default pooled client as a negative control', async () => {
    await withApi(true, async (api, worker, events, deadline) => {
      await expect(crossIdleDeadline(api, worker, events, deadline)).rejects.toThrow('ECONNRESET');
      expect(
        events.filter((event) => event.event === 'request').map((event) => event.path)
      ).toEqual(['/warm', '/warm-again']);
    });
  }, 15000);

  it('still exposes a genuine server disconnect without retrying the request', async () => {
    await withApi(false, async (api, _worker, events) => {
      await expect(api.get('/disconnect')).rejects.toThrow();
      expect(events.filter((event) => event.event === 'request')).toHaveLength(1);
    });
  });

  it('preserves permission denial without retrying it', async () => {
    await withApi(false, async (api, _worker, events) => {
      expect((await api.get('/forbidden')).status()).toBe(403);
      expect(events.filter((event) => event.event === 'request')).toHaveLength(1);
    });
  });
});
