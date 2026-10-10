import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { realpath } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { compileStrapi, createStrapi } = require('@strapi/strapi');
const pluginPath = await realpath(
  require.resolve('strapi-plugin-general-translation/strapi-server')
);
assert.ok(!pluginPath.includes('/packages/plugin/'), 'Fresh install resolved the workspace source');
const strapi = await createStrapi(await compileStrapi()).load();
try {
  assert.ok(strapi.plugin('general-translation'));
  const articles = await strapi
    .documents('api::article.article')
    .findMany({ locale: 'en', status: 'published' });
  assert.equal(articles.length, 1);
  const drafts = await strapi
    .documents('api::article.article')
    .findMany({ locale: 'en', status: 'draft' });
  assert.equal(drafts.length, 2);
  process.stdout.write(
    'Packed plugin loaded in the official scaffold; publication controls passed.\n'
  );
} finally {
  await strapi.destroy();
}
