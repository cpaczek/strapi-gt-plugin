import { describe, expect, it } from 'vitest';
import { authorizeDocument } from '../../server/src/authorization';
import { PERMISSIONS } from '../../shared/constants';

const source = { documentId: 'doc', locale: 'en', createdBy: { id: 7 }, title: 'Title' };
const target = { documentId: 'doc', locale: 'fr', title: 'Titre' };
const check = (overrides: Partial<Parameters<typeof authorizeDocument>[0]> = {}) =>
  authorizeDocument({
    pluginAllowed: true,
    source,
    target,
    targetLocale: 'fr',
    fields: ['title'],
    createMissingLocales: false,
    publish: false,
    can: () => true,
    ...overrides,
  });

describe('content authorization', () => {
  it('requires the plugin action in addition to content rights', () =>
    expect(() => check({ pluginAllowed: false })).toThrow());
  it('requires read access to every source field', () =>
    expect(() =>
      check({
        can: (action, document, field) =>
          !(action === 'read' && document.locale === 'en' && field === 'title'),
      })
    ).toThrow());
  it('checks target locale against the target entity', () =>
    expect(() => check({ can: (_action, document) => document.locale !== 'fr' })).toThrow());
  it('refuses implicitly created locales when creation is off', () =>
    expect(() => check({ target: null })).toThrow());
  it('requires create permission for a missing locale', () =>
    expect(() =>
      check({ target: null, createMissingLocales: true, can: (action) => action !== 'create' })
    ).toThrow());
  it('requires publish permission independently from update', () =>
    expect(() => check({ publish: true, can: (action) => action !== 'publish' })).toThrow());
  it('permits an authorized draft translation', () => expect(() => check()).not.toThrow());
  it('uses source ownership in its read condition', () =>
    expect(() =>
      check({ can: (_action, document) => document.createdBy === undefined })
    ).toThrow());
  it('does not confuse the bulk permission with settings permission', () =>
    expect(PERMISSIONS.bulkTranslate).not.toBe(PERMISSIONS.writeSettings));
});
