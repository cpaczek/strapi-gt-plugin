import type { Core } from '@strapi/strapi';
import { articles, category, locales, editorialFieldContext } from './content';

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
  const store = strapi.store({ type: 'core', name: 'editorial-example', key: 'seed-v2' });
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
      name: 'The block custody portrait',
      alternativeText:
        'Original pixel drawing of a tall purple-eyed character holding a tiny grass block beneath two moons',
      caption: 'Exhibit A. The block declined to comment.',
      width: 1600,
      height: 1000,
      formats: {},
      hash: 'ender_block_custody',
      ext: '.svg',
      mime: 'image/svg+xml',
      size: 1.2,
      url: '/images/block-custody.svg',
      provider: 'local',
    },
  });
  for (const article of articles) {
    const fields = structuredClone(article.fields);
    const created = await strapi.documents('api::article.article').create({
      locale: 'en',
      data: {
        ...fields,
        category: categoryRecord.documentId,
        cover: numericId(file),
        sections: fields.sections.map((section) =>
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
  await strapi.store({ type: 'plugin', name: 'general-translation', key: 'settings' }).set({
    value: {
      projectId: process.env.GT_PROJECT_ID ?? 'editorial',
      sourceLocale: 'en',
      targetLocales: ['fr', 'ar'],
      localeMapping: {},
      createMissingLocales: true,
      autoPublish: false,
      automaticMode: 'off',
      contentTypes: {
        'api::article.article': {
          mediaMetadata: false,
          fields: {
            title: { translate: true, context: editorialFieldContext },
            summary: { translate: true, context: editorialFieldContext },
            body: { translate: true, context: editorialFieldContext },
            markdown: { translate: true, context: editorialFieldContext },
            sections: { translate: true, context: editorialFieldContext },
            glossary: { translate: true, context: editorialFieldContext },
            'glossary.term': { translate: false },
            editorialNote: { translate: true, context: editorialFieldContext },
            slug: { translate: false, uidStrategy: 'regenerate', sourceField: 'title' },
          },
        },
      },
    },
  });
  await store.set({ value: true });
};
