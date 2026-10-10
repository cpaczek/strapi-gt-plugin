import type { Core } from '@strapi/strapi';
import { articles, category, locales } from './content';

const numericId = (record: unknown): number => {
  if (
    typeof record === 'object' &&
    record !== null &&
    'id' in record &&
    typeof record.id === 'number'
  )
    return record.id;
  throw new TypeError('Seed record did not return a numeric identifier');
};

export const seedEditorialContent = async (strapi: Core.Strapi): Promise<void> => {
  const store = strapi.store({ type: 'core', name: 'editorial-example', key: 'seed-v1' });
  if (await store.get()) return;
  for (const locale of locales) {
    const existing: unknown = await strapi.db
      .query('plugin::i18n.locale')
      .findOne({ where: { code: locale.code } });
    if (!existing) await strapi.db.query('plugin::i18n.locale').create({ data: locale });
  }
  const categoryRecord = await strapi
    .documents('api::category.category')
    .create({ data: category });
  const file: unknown = await strapi.db.query('plugin::upload.file').create({
    data: {
      name: 'Tidal study',
      alternativeText: 'Abstract bands of sea, sand, and a small coastal house',
      caption: 'A study of the coast at low tide.',
      width: 1600,
      height: 1000,
      formats: {},
      hash: 'editorial_tidal_study',
      ext: '.svg',
      mime: 'image/svg+xml',
      size: 1.2,
      url: '/images/tidal-study.svg',
      provider: 'local',
    },
  });
  for (const article of articles) {
    const created = await strapi.documents('api::article.article').create({
      locale: 'en',
      data: {
        ...article.fields,
        category: categoryRecord.documentId,
        cover: numericId(file),
        sections: article.fields.sections.map((section) =>
          section.__component === 'editorial.gallery'
            ? { ...section, images: [numericId(file)] }
            : section
        ),
      },
    });
    if (article.publish)
      await strapi
        .documents('api::article.article')
        .publish({ documentId: created.documentId, locale: 'en' });
  }
  const publicRole: unknown = await strapi.db
    .query('plugin::users-permissions.role')
    .findOne({ where: { type: 'public' } });
  if (!publicRole) throw new Error('Public reader role was not created');
  for (const action of [
    'api::article.article.find',
    'api::article.article.findOne',
    'api::category.category.find',
    'api::category.category.findOne',
  ]) {
    const existing: unknown = await strapi.db
      .query('plugin::users-permissions.permission')
      .findOne({ where: { action, role: numericId(publicRole) } });
    if (!existing)
      await strapi.db
        .query('plugin::users-permissions.permission')
        .create({ data: { action, role: numericId(publicRole) } });
  }
  await store.set({ value: true });
};
