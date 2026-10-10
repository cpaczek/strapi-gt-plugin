import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../app/api/health/route';

vi.mock('server-only', () => ({}));
afterEach(() => vi.unstubAllGlobals());

describe('reader startup readiness', () => {
  it('waits for Strapi before accepting a ready reader', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', transport);
    expect((await GET()).status).toBe(204);
    expect(transport).toHaveBeenCalledOnce();
    const [url, options] = transport.mock.calls[0] ?? [];
    expect(new URL(String(url)).pathname).toBe('/_health');
    expect(options?.cache).toBe('no-store');
    expect(options?.redirect).toBe('manual');
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(options?.headers).toBeUndefined();
  });

  it.each([200, 201, 202, 301, 302, 400, 401, 403, 404, 500, 503])(
    'does not mistake upstream status %i for Strapi readiness',
    async (status) => {
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>().mockResolvedValue(new Response('Not ready', { status }))
      );
      const response = await GET();
      expect(response.status).toBe(503);
      expect(await response.text()).toBe('');
    }
  );

  it('keeps transport failure details out of the public response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockRejectedValue(new Error('Private connection detail'))
    );
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('');
  });

  it('recovers on a later probe after the backend starts', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockRejectedValueOnce(new Error('Backend is still booting'))
        .mockResolvedValueOnce(new Response(null, { status: 204 }))
    );
    expect((await GET()).status).toBe(503);
    expect((await GET()).status).toBe(204);
  });
});
