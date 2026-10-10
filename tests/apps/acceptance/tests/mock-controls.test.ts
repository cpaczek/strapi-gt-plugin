import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { isLoopbackAddress, startMockGt, type MockGtServer } from '../src/mock-gt';

const servers: MockGtServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});
const setup = async (enabled = true) => {
  const apiKey = randomBytes(24).toString('hex');
  const controlToken = randomBytes(24).toString('hex');
  const server = await startMockGt({ apiKey, ...(enabled ? { controlToken } : {}) });
  servers.push(server);
  const control = (
    path: string,
    token = controlToken,
    body?: unknown,
    method = body ? 'POST' : 'GET'
  ) =>
    fetch(`${server.url}/__test__/${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  return { server, apiKey, controlToken, control };
};

describe('explicit local mock controls', () => {
  it('keeps controls disabled by default', async () => {
    const { apiKey, control } = await setup(false);
    expect((await control('job-status', apiKey, { status: 'processing' })).status).toBe(404);
    expect((await control('requests', apiKey)).status).toBe(404);
  });
  it('authenticates controls separately from mocked GT requests', async () => {
    const { apiKey, control } = await setup();
    expect((await control('job-status', apiKey, { status: 'processing' })).status).toBe(401);
    expect((await control('requests', '')).status).toBe(401);
  });
  it('holds and releases file jobs with an explicit authenticated barrier', async () => {
    const { control } = await setup();
    expect((await control('job-status', undefined, { status: 'processing' })).status).toBe(200);
    expect((await control('job-status', undefined, { status: 'completed' })).status).toBe(200);
  });
  it('returns counts only and never exposes content or either credential', async () => {
    const { server, apiKey, controlToken, control } = await setup();
    await fetch(`${server.url}/v2/translate`, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        sourceLocale: 'en',
        targetLocale: 'fr',
        metadata: {},
        requests: { title: { source: 'Private synthetic article' } },
      }),
    });
    const response = await control('requests');
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
      runtimeRequests: 1,
      uploads: 0,
      enqueues: 0,
      polls: 0,
      downloads: 0,
    });
    expect(text).not.toContain('Private synthetic article');
    expect(text).not.toContain(apiKey);
    expect(text).not.toContain(controlToken);
    expect(server.requests).toHaveLength(1);
  });
  it.each([{ status: 'failed' }, { status: 'unknown' }, { status: 'completed', extra: 'ignored' }])(
    'rejects unsupported control data $status',
    async (body) => {
      const { control } = await setup();
      expect((await control('job-status', undefined, body)).status).toBe(400);
    }
  );
  it('rejects unknown paths and method changes', async () => {
    const { control } = await setup();
    expect((await control('reset-all')).status).toBe(404);
    expect((await control('requests', undefined, {}, 'POST')).status).toBe(404);
  });
  it('does not consume the next intended GT failure', async () => {
    const { server, apiKey, control } = await setup();
    server.failNext({ status: 429 });
    expect((await control('requests')).status).toBe(200);
    expect(
      (
        await fetch(`${server.url}/v2/project/info/editorial`, {
          headers: { authorization: `Bearer ${apiKey}` },
        })
      ).status
    ).toBe(429);
  });
});

describe('control socket boundary', () => {
  it.each(['127.0.0.1', '127.2.3.4', '::1', '::ffff:127.0.0.1'])(
    'accepts the loopback socket %s',
    (address) => {
      expect(isLoopbackAddress(address)).toBe(true);
    }
  );
  it.each([
    undefined,
    '',
    'localhost',
    '0.0.0.0',
    '192.168.1.2',
    '::',
    '::ffff:192.168.1.2',
    '127.0.0.1.example',
    '127.0.0.256',
  ])('rejects a non-loopback or invalid socket %s', (address) => {
    expect(isLoopbackAddress(address)).toBe(false);
  });
});
