import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startStrapiFixture } from './strapi-fixture';

let fixture: Awaited<ReturnType<typeof startStrapiFixture>> | undefined;
beforeAll(async () => {
  fixture = await startStrapiFixture();
}, 60_000);
afterAll(async () => {
  if (fixture) await fixture.close();
}, 60_000);
const app = () => {
  if (!fixture) throw new Error('Strapi fixture did not boot');
  return fixture;
};
describe('real Strapi plugin runtime', () => {
  it('uses the registered plugin runtime', () => {
    expect(app().strapi.plugin('general-translation').service('translation')).toBe(app().runtime);
  });
  it('translates a missing locale as an attributed draft', async () => {
    const { runtime, source, actorId, strapi } = app();
    const response = await runtime.enqueue(
      {
        contentType: 'api::article.article',
        documentIds: [source.documentId],
        targetLocales: ['fr'],
        force: false,
      },
      actorId,
      'translate'
    );
    const id = response.jobs[0]?.id;
    if (!id) throw new Error('No translation job was created');
    await runtime.worker.execute();
    await runtime.worker.execute();
    const job = await runtime.repository.get(id);
    expect(job).toMatchObject({ status: 'succeeded' });
    const target: unknown = await strapi
      .documents('api::article.article')
      .findOne({
        documentId: source.documentId,
        locale: 'fr',
        status: 'draft',
        populate: { createdBy: true, updatedBy: true, image: true },
      });
    expect(target).toMatchObject({
      title: '[fr] Hello',
      createdBy: { id: actorId },
      updatedBy: { id: actorId },
    });
    expect(
      await strapi
        .documents('api::article.article')
        .findOne({ documentId: source.documentId, locale: 'fr', status: 'published' })
    ).toBeNull();
  });
});
