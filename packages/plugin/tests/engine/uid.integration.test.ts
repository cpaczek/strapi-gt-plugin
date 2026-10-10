import { createServer } from 'node:http';
import { once } from 'node:events';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { startStrapiFixture } from '../server/strapi-fixture';
import { REQUEST_TIMEOUT_MS } from '../../shared/constants';

vi.setConfig({ testTimeout: REQUEST_TIMEOUT_MS * 2, hookTimeout: REQUEST_TIMEOUT_MS * 4 });
const outputs = new Map([
  ['Arabic interview', 'مرحبا بك'],
  ['Greek interview', 'Καλημέρα κόσμε'],
  ['Chinese interview', '末地使者'],
  ['Another Chinese interview', '末地使者'],
  ['Duplicate Arabic interview', 'مرحبا بك'],
]);
const runtimeRequest = z.object({
  requests: z.record(z.string(), z.object({ source: z.string() })),
  targetLocale: z.string(),
});
const receipts: string[][] = [];
const provider = createServer(async (incoming, outgoing) => {
  const chunks: Buffer[] = [];
  for await (const chunk of incoming) {
    const bytes: unknown = chunk;
    if (Buffer.isBuffer(bytes)) chunks.push(bytes);
  }
  const request: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const parsed = runtimeRequest.parse(request);
  receipts.push(Object.values(parsed.requests).map((entry) => entry.source));
  const reply = Object.fromEntries(
    Object.entries(parsed.requests).map(([id, entry]) => [
      id,
      {
        success: true,
        translation: outputs.get(entry.source) ?? entry.source,
        dataFormat: 'STRING',
        locale: parsed.targetLocale,
      },
    ])
  );
  outgoing.writeHead(200, { 'content-type': 'application/json' });
  outgoing.end(JSON.stringify(reply));
});
let fixture: Awaited<ReturnType<typeof startStrapiFixture>> | undefined;
beforeAll(async () => {
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  const address = provider.address();
  if (!address || typeof address === 'string')
    throw new Error('Expected a local provider listener');
  fixture = await startStrapiFixture({
    uid: true,
    gtBaseUrl: `http://127.0.0.1:${address.port}`,
    locales: ['fr', 'ar', 'el', 'zh'],
  });
  await fixture.runtime.saveSettings({
    ...fixture.settings,
    targetLocales: ['ar', 'el', 'zh'],
    contentTypes: {
      'api::article.article': {
        mediaMetadata: false,
        fields: {
          title: { translate: true },
          slug: { translate: true, uidStrategy: 'regenerate' },
          summary: { translate: false },
          image: { translate: false },
        },
      },
    },
  });
});
afterAll(async () => {
  try {
    if (fixture) await fixture.close();
  } finally {
    await new Promise<void>((resolve, reject) =>
      provider.close((failure) => (failure ? reject(failure) : resolve()))
    );
  }
});
const app = () => {
  if (!fixture) throw new Error('Strapi UID fixture did not boot');
  return fixture;
};
const translate = async (title: string, locale: string) => {
  const { strapi, runtime, actorId } = app();
  const source = z.object({ documentId: z.string() }).parse(
    await strapi.documents('api::article.article').create({
      locale: 'en',
      data: {
        title,
        slug: `source-${title.toLowerCase().replaceAll(' ', '-')}`,
        createdBy: actorId,
        updatedBy: actorId,
      },
    })
  );
  const queued = await runtime.enqueue(
    {
      contentType: 'api::article.article',
      documentIds: [source.documentId],
      targetLocales: [locale],
      force: false,
    },
    actorId,
    'translate'
  );
  const id = queued.jobs[0]?.id;
  if (!id) throw new Error('Expected a UID translation job');
  await runtime.worker.execute();
  await runtime.worker.execute();
  expect(await runtime.repository.get(id)).toMatchObject({ status: 'succeeded' });
  return source.documentId;
};

describe('native Strapi publication of translated UIDs', () => {
  it.each([
    ['Arabic interview', 'ar', 'مرحبا بك'],
    ['Greek interview', 'el', 'Καλημέρα κόσμε'],
    ['Chinese interview', 'zh', '末地使者'],
  ])('publishes actual non-Latin output for %s', async (sourceTitle, locale, translatedTitle) => {
    const documentId = await translate(sourceTitle, locale);
    const { strapi } = app();
    expect(
      await strapi
        .documents('api::article.article')
        .findOne({ documentId, locale, status: 'published' })
    ).toBeNull();
    await strapi.documents('api::article.article').publish({ documentId, locale });
    const published = z
      .object({ title: z.string(), slug: z.string(), publishedAt: z.string() })
      .parse(
        await strapi
          .documents('api::article.article')
          .findOne({ documentId, locale, status: 'published' })
      );
    expect(published.title).toBe(translatedTitle);
    expect(published.slug).toMatch(/^[A-Za-z0-9-_.~]+$/);
    expect(receipts.flat()).not.toContain(
      `source-${sourceTitle.toLowerCase().replaceAll(' ', '-')}`
    );
  });
  it('publishes distinct document-bound fallbacks for identical Chinese titles', async () => {
    const first = await translate('Chinese interview', 'zh');
    const second = await translate('Another Chinese interview', 'zh');
    const { strapi } = app();
    await strapi.documents('api::article.article').publish({ documentId: first, locale: 'zh' });
    await strapi.documents('api::article.article').publish({ documentId: second, locale: 'zh' });
    const read = async (documentId: string) =>
      z
        .object({ slug: z.string() })
        .parse(
          await strapi
            .documents('api::article.article')
            .findOne({ documentId, locale: 'zh', status: 'published' })
        );
    expect((await read(first)).slug).not.toBe((await read(second)).slug);
  });
  it('keeps native UID format and uniqueness enforcement active', async () => {
    const { strapi, actorId } = app();
    const invalid = z.object({ documentId: z.string() }).parse(
      await strapi.documents('api::article.article').create({
        locale: 'en',
        data: {
          title: 'Invalid UID control',
          slug: 'غير-صالح',
          createdBy: actorId,
          updatedBy: actorId,
        },
      })
    );
    await expect(
      strapi
        .documents('api::article.article')
        .publish({ documentId: invalid.documentId, locale: 'en' })
    ).rejects.toThrow();
    const duplicate = await translate('Duplicate Arabic interview', 'ar');
    await expect(
      strapi.documents('api::article.article').publish({ documentId: duplicate, locale: 'ar' })
    ).rejects.toThrow(/unique/i);
  });
});
