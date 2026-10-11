import { describe, expect, it, vi } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createGtClient } from '../../server/src/engine/client';
import { REQUEST_TIMEOUT_MS } from '../../shared/constants';
import { formatUnknownError } from '../../shared/messages';
import {
  startMockGt,
  type MockConnectionEvent,
} from '../../../../tests/apps/acceptance/src/mock-gt';

const request = {
  sourceLocale: 'en',
  targetLocale: 'fr',
  segments: [
    { id: 'idle-probe', text: 'A fixture message', kind: 'text' as const, path: ['title'] },
  ],
};

describe('mock transport across synchronous application work', () => {
  it(
    'keeps the next paid POST usable after two responses and an expired idle deadline',
    async () => {
      const events: MockConnectionEvent[] = [];
      const transport: { status?: number; error?: string; code?: string }[] = [];
      const realFetch = globalThis.fetch;
      const capture = vi.spyOn(globalThis, 'fetch').mockImplementation(async (...parameters) => {
        try {
          const response = await realFetch(...parameters);
          transport.push({ status: response.status });
          return response;
        } catch (failure) {
          const cause = failure instanceof Error ? failure.cause : undefined;
          transport.push({
            error: formatUnknownError(failure),
            code:
              cause instanceof Error && 'code' in cause && typeof cause.code === 'string'
                ? formatUnknownError(cause.code)
                : undefined,
          });
          throw failure;
        }
      });
      const mock = await startMockGt({
        apiKey: 'local-mock-idle-control',
        onConnectionEvent: (event) => events.push(event),
      });
      const client = createGtClient({
        apiKey: 'local-mock-idle-control',
        projectId: 'editorial',
        baseUrl: mock.url,
      });
      try {
        await expect(client.translate(request)).resolves.toEqual({
          'idle-probe': '[fr] A fixture message',
        });
        await expect(client.translate(request)).resolves.toEqual({
          'idle-probe': '[fr] A fixture message',
        });
        const lastResponse = events.filter((event) => event.event === 'response-finish').at(-1);
        if (!lastResponse?.idleDeadlineMs)
          throw new Error('The mock did not report its idle deadline');
        // Synchronous document work prevents both peers from processing idle timers.
        // Two responses occupy the native fetch pool; a single warmup does not reproduce the race.
        const deadline = performance.now() + lastResponse.idleDeadlineMs + 100;
        const document = JSON.stringify(
          Array.from({ length: 100 }, (_, index) => ({ index, title: 'Fixture document' }))
        );
        while (performance.now() < deadline) JSON.parse(document);
        await expect(client.translate(request)).resolves.toEqual({
          'idle-probe': '[fr] A fixture message',
        });
        expect(mock.requests).toHaveLength(3);
        expect(transport).toEqual([{ status: 200 }, { status: 200 }, { status: 200 }]);
        expect(
          events.filter((event) => event.event === 'request').map((event) => event.connectionId)
        ).toEqual([1, 2, 3]);
        expect(events.some((event) => event.event === 'timeout')).toBe(false);
      } finally {
        capture.mockRestore();
        await mock.close();
        const evidence = resolve(import.meta.dirname, '../../../../.work/server-stability');
        await mkdir(evidence, { recursive: true });
        await writeFile(
          resolve(evidence, `mock-idle-${Date.now()}-${process.pid}.json`),
          JSON.stringify({ events, transport, requests: mock.requests.length }, null, 2),
          { mode: 0o600 }
        );
      }
    },
    REQUEST_TIMEOUT_MS
  );
});
