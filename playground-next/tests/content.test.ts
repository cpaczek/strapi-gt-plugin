import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createContentReader, articlePath, isReaderLocale } from '../lib/content';

const publishedArticle = {
  documentId: 'stable-document',
  locale: 'fr',
  title: 'The quiet coast',
  slug: 'the-quiet-coast',
  summary: 'Field notes from the water',
  publishedAt: '2026-01-01T00:00:00.000Z',
  body: [],
  sections: [],
};
const respond = (payload: unknown) =>
  vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));

describe('published content delivery', () => {
  it('requests explicit publication and locale from Strapi', async () => {
    const transport = respond({ data: [publishedArticle] });
    const reader = createContentReader({ origin: 'http://127.0.0.1:1337', fetch: transport });
    const articles = await reader.list('fr');
    expect(articles).toHaveLength(1);
    const request = new URL(String(transport.mock.calls[0]?.[0]));
    expect(request.searchParams.get('status')).toBe('published');
    expect(request.searchParams.get('locale')).toBe('fr');
    expect(transport.mock.calls[0]?.[1]?.cache).toBe('no-store');
  });
  it('does not expose draft records even if the backend returns one', async () => {
    const reader = createContentReader({
      origin: 'http://127.0.0.1:1337',
      fetch: respond({ data: [{ ...publishedArticle, publishedAt: null }] }),
    });
    expect(await reader.list('fr')).toEqual([]);
  });
  it('uses document identity for details and switching languages', async () => {
    const transport = respond({ data: publishedArticle });
    const reader = createContentReader({ origin: 'http://127.0.0.1:1337', fetch: transport });
    expect(await reader.get('stable-document', 'fr')).toMatchObject({
      documentId: 'stable-document',
    });
    expect(new URL(String(transport.mock.calls[0]?.[0])).pathname).toBe(
      '/api/articles/stable-document'
    );
    expect(articlePath('ar', 'stable-document')).toBe('/ar/articles/stable-document');
  });
  it('treats an unpublished or missing language as absent', async () => {
    const reader = createContentReader({
      origin: 'http://127.0.0.1:1337',
      fetch: respond({ data: null }),
    });
    expect(await reader.get('stable-document', 'ar')).toBeNull();
  });
  it('rejects unknown languages before making a request', async () => {
    expect(isReaderLocale('fr')).toBe(true);
    expect(isReaderLocale('../../admin')).toBe(false);
  });
  it('keeps a supplied token in server requests and never in the URL', async () => {
    const transport = respond({ data: [] });
    const token = randomBytes(24).toString('hex');
    const reader = createContentReader({
      origin: 'http://127.0.0.1:1337',
      token,
      fetch: transport,
    });
    await reader.list('en');
    expect(String(transport.mock.calls[0]?.[0])).not.toContain(token);
    expect(new Headers(transport.mock.calls[0]?.[1]?.headers).get('authorization')).toBe(
      `Bearer ${token}`
    );
  });
});

describe('published reader boundary cases', () => {
  it('drops a record from the wrong locale', async () => {
    const reader = createContentReader({
      origin: 'http://127.0.0.1:1337',
      fetch: respond({ data: [publishedArticle] }),
    });
    expect(await reader.list('ar')).toEqual([]);
  });
  it('rejects a detail response with a different document identity', async () => {
    const reader = createContentReader({
      origin: 'http://127.0.0.1:1337',
      fetch: respond({ data: publishedArticle }),
    });
    expect(await reader.get('different-document', 'fr')).toBeNull();
  });
  it('treats an HTTP 404 as absent', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 404 }));
    expect(
      await createContentReader({ origin: 'http://127.0.0.1:1337', fetch: transport }).get(
        'missing',
        'fr'
      )
    ).toBeNull();
  });
  it('does not disguise a failed content server as an empty edition', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 503 }));
    await expect(
      createContentReader({ origin: 'http://127.0.0.1:1337', fetch: transport }).list('en')
    ).rejects.toThrow('503');
  });
  it('rejects malformed article payloads', async () => {
    const reader = createContentReader({
      origin: 'http://127.0.0.1:1337',
      fetch: respond({ data: [{ ...publishedArticle, title: 7 }] }),
    });
    await expect(reader.list('fr')).rejects.toThrow();
  });
  it('keeps unusual Unicode and empty bodies intact', async () => {
    const title = 'مرحبا بالعالم café 🐚';
    const reader = createContentReader({
      origin: 'http://127.0.0.1:1337',
      fetch: respond({ data: [{ ...publishedArticle, locale: 'ar', title }] }),
    });
    expect((await reader.list('ar'))[0]?.title).toBe(title);
  });
  it('encodes document identities instead of interpreting path fragments', () => {
    expect(articlePath('fr', 'a/b?status=draft')).toBe('/fr/articles/a%2Fb%3Fstatus%3Ddraft');
  });
  it('refuses credentials embedded in a server URL', () => {
    expect(() =>
      createContentReader({ origin: 'https://user:password@example.invalid' })
    ).toThrow();
  });
  it('refuses non-HTTP content origins', () => {
    expect(() => createContentReader({ origin: 'file:///tmp/content' })).toThrow();
  });
  it('does not return a draft detail', async () => {
    const reader = createContentReader({
      origin: 'http://127.0.0.1:1337',
      fetch: respond({ data: { ...publishedArticle, publishedAt: null } }),
    });
    expect(await reader.get('stable-document', 'fr')).toBeNull();
  });
  it('accepts missing optional media without inventing image metadata', async () => {
    const reader = createContentReader({
      origin: 'http://127.0.0.1:1337',
      fetch: respond({ data: publishedArticle }),
    });
    expect((await reader.get('stable-document', 'fr'))?.cover).toBeUndefined();
  });
  it('does not copy unknown private fields into article output', async () => {
    const reader = createContentReader({
      origin: 'http://127.0.0.1:1337',
      fetch: respond({ data: { ...publishedArticle, contactEmail: 'private@example.invalid' } }),
    });
    expect(await reader.get('stable-document', 'fr')).not.toHaveProperty('contactEmail');
  });
});
