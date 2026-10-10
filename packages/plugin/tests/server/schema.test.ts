import { describe, expect, it } from 'vitest';
import { readSchema, populateSchema, permissionField } from '../../server/src/strapi-schema';
import { fieldAtPath } from '../../server/src/settings';
import type { ContentSchema } from '../../shared/contracts';

const component: ContentSchema = {
  uid: 'shared.panel',
  localized: true,
  draftAndPublish: false,
  attributes: { title: { type: 'string' }, image: { type: 'media' } },
};
const schema: ContentSchema = {
  uid: 'api::article.article',
  localized: true,
  draftAndPublish: true,
  attributes: {
    title: { type: 'string', localized: true },
    body: { type: 'blocks', localized: true },
    panels: { type: 'component', component: component.uid, repeatable: true, localized: true },
    zone: { type: 'dynamiczone', components: [component.uid], localized: true },
    secret: { type: 'media', private: true },
  },
};
const components = { [component.uid]: component };

describe('Strapi schema metadata', () => {
  it('reads localization from plugin options rather than injected locale fields', () =>
    expect(
      readSchema('api::article.article', { attributes: { locale: { type: 'string' } } }).localized
    ).toBe(false));
  it('retains private and nonlocalized field exclusions', () => {
    const parsed = readSchema('api::article.article', {
      pluginOptions: { i18n: { localized: true } },
      attributes: {
        title: { type: 'string', pluginOptions: { i18n: { localized: true } } },
        secret: { type: 'password', private: true },
        number: { type: 'integer' },
      },
    });
    expect(parsed.attributes.title?.localized).toBe(true);
    expect(parsed.attributes.secret?.private).toBe(true);
    expect(parsed.attributes.number?.localized).toBe(false);
  });
  it('treats UID fields as localized according to the installed contract', () =>
    expect(
      readSchema('api::article.article', { attributes: { slug: { type: 'uid' } } }).attributes.slug
        ?.localized
    ).toBe(true));
  it('ignores unknown field types without making them translatable', () =>
    expect(
      readSchema('api::article.article', {
        attributes: { custom: { type: 'unknown' }, malformed: null },
      }).attributes
    ).toEqual({}));
  it('rejects a missing content schema', () => expect(() => readSchema('article', null)).toThrow());
  it('builds recursive component and dynamic zone populations', () => {
    const populate = populateSchema(schema, components);
    expect(populate).toMatchObject({
      panels: { populate: { image: true } },
      zone: { on: { 'shared.panel': { populate: { image: true } } } },
      createdBy: { fields: ['id'] },
    });
    expect(populate).not.toHaveProperty('secret');
  });
  it('rejects cyclic component schemas', () => {
    const cyclic = {
      ...component,
      attributes: { child: { type: 'component' as const, component: component.uid } },
    };
    expect(() => populateSchema(cyclic, { [component.uid]: cyclic })).toThrow();
  });
  it('maps a Blocks text path to its actual permission field', () =>
    expect(permissionField(schema, components, {}, ['body', 0, 'children', 0, 'text'])).toBe(
      'body'
    ));
  it('maps a repeated component path without numeric indexes', () =>
    expect(
      permissionField(schema, components, { panels: [{ title: 'Title' }] }, ['panels', 0, 'title'])
    ).toBe('panels.title'));
  it('maps dynamic zones through their component schema', () =>
    expect(
      permissionField(
        schema,
        components,
        { zone: [{ __component: component.uid, title: 'Title' }] },
        ['zone', 0, 'title']
      )
    ).toBe('zone.title'));
  it('resolves nested configured fields', () =>
    expect(fieldAtPath(schema, components, 'panels.title')?.type).toBe('string'));
  it('resolves dynamic-zone configured fields', () =>
    expect(fieldAtPath(schema, components, 'zone.image')?.type).toBe('media'));
  it('does not treat arbitrary nested keys as schema fields', () =>
    expect(fieldAtPath(schema, components, 'title.secret')).toBeUndefined());
});

it('resolves the actual dynamic-zone item when component schemas differ', () => {
  const second: ContentSchema = {
    uid: 'shared.other',
    localized: true,
    draftAndPublish: false,
    attributes: { content: { type: 'component', component: component.uid } },
  };
  const root: ContentSchema = {
    ...schema,
    attributes: {
      zone: { type: 'dynamiczone', components: [component.uid, second.uid], localized: true },
    },
  };
  const result = permissionField(
    root,
    { ...components, [second.uid]: second },
    {
      zone: [
        { __component: component.uid, title: 'First' },
        { __component: second.uid, content: { title: 'Second' } },
      ],
    },
    ['zone', 1, 'content', 'title']
  );
  expect(result).toBe('zone.content.title');
});
