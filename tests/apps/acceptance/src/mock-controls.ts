import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { loopbackOrigin } from './browser-fixture';

const fixture = z.object({ url: z.string(), token: z.string().min(24) });
const counters = z.object({
  runtimeRequests: z.number(),
  uploads: z.number(),
  enqueues: z.number(),
  polls: z.number(),
  downloads: z.number(),
});
export const readMockControls = async () => {
  const { url, token } = fixture.parse(
    JSON.parse(
      await readFile(
        process.env.TESTBED_MOCK_CONTROL_FILE ??
          resolve(import.meta.dirname, '../../../../.work/testbed/mock-control.json'),
        'utf8'
      )
    )
  );
  const origin = loopbackOrigin(url);
  const request = async (path: string, status?: 'processing' | 'completed') => {
    // Node fetch keeps the private control credential out of browser traces.
    const response = await fetch(`${origin}/__test__/${path}`, {
      method: status ? 'POST' : 'GET',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(status ? { body: JSON.stringify({ status }) } : {}),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Local mock control failed with status ${response.status}`);
    return response.json();
  };
  return {
    setJobStatus: async (status: 'processing' | 'completed') => {
      await request('job-status', status);
    },
    counters: async () => counters.parse(await request('requests')),
  };
};
