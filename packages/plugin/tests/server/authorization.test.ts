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

import { loadActorPermissions, checkContent } from '../../server/src/authorization';
import { persistenceFixture } from './persistence-fixture';

describe('current actor authority', () => {
  const setup = async () => {
    const fixture = persistenceFixture();
    await fixture.host.db
      .query('admin::user')
      .create({ data: { isActive: true, roles: [{ id: 1 }] } });
    const permission = {
      engine: {
        generateUserAbility: async () => ({
          can: (action: string) => action === PERMISSIONS.translate,
        }),
      },
    };
    const checker = {
      can: (action: string, entity: { locale?: unknown }, field?: string) =>
        action === 'plugin::content-manager.explorer.read' &&
        entity.locale === 'en' &&
        field !== 'secret',
    };
    return {
      fixture,
      host: {
        ...fixture.host,
        service: () => permission,
        plugin: () => ({ service: () => ({ create: () => checker }) }),
      },
      permission,
    };
  };
  it('loads plugin and content ability through public service access', async () => {
    const { host } = await setup();
    const actor = await loadActorPermissions(host, 1);
    expect(actor.plugin('translate')).toBe(true);
    expect(actor.plugin('writeSettings')).toBe(false);
    expect(checkContent(actor.checker('article'))('read', { locale: 'en' }, 'title')).toBe(true);
    expect(checkContent(actor.checker('article'))('read', { locale: 'fr' }, 'title')).toBe(false);
  });
  it('refuses a missing automation principal', async () => {
    const { host } = await setup();
    await expect(loadActorPermissions(host, null)).rejects.toThrow();
  });
  it('refuses a deleted principal', async () => {
    const { host } = await setup();
    await expect(loadActorPermissions(host, 99)).rejects.toThrow();
  });
  it('refuses a deactivated user on the next check', async () => {
    const { host } = await setup();
    await loadActorPermissions(host, 1);
    await host.db.query('admin::user').update({ where: { id: 1 }, data: { isActive: false } });
    await expect(loadActorPermissions(host, 1)).rejects.toThrow();
  });
  it('refuses a blocked user', async () => {
    const { host } = await setup();
    await host.db.query('admin::user').update({ where: { id: 1 }, data: { blocked: true } });
    await expect(loadActorPermissions(host, 1)).rejects.toThrow();
  });
  it('uses fresh role permissions rather than cached authority', async () => {
    const { host, permission } = await setup();
    const first = await loadActorPermissions(host, 1);
    expect(first.plugin('translate')).toBe(true);
    permission.engine.generateUserAbility = async () => ({ can: () => false });
    expect((await loadActorPermissions(host, 1)).plugin('translate')).toBe(false);
  });
  it('fails closed if the permission service shape changes', async () => {
    const { host } = await setup();
    await expect(loadActorPermissions({ ...host, service: () => ({}) }, 1)).rejects.toThrow();
  });
  it('fails closed if the checker factory is missing', async () => {
    const { host } = await setup();
    await expect(
      loadActorPermissions({ ...host, plugin: () => ({ service: () => ({}) }) }, 1)
    ).rejects.toThrow();
  });
  it('fails closed for an invalid generated ability', async () => {
    const { host } = await setup();
    await expect(
      loadActorPermissions(
        { ...host, service: () => ({ engine: { generateUserAbility: async () => null } }) },
        1
      )
    ).rejects.toThrow();
  });
  it('fails closed for an invalid content checker', async () => {
    const { host } = await setup();
    const actor = await loadActorPermissions(
      { ...host, plugin: () => ({ service: () => ({ create: () => null }) }) },
      1
    );
    expect(() => actor.checker('article')).toThrow();
  });
  it('does not broaden field permissions to sibling fields', async () => {
    const { host } = await setup();
    const actor = await loadActorPermissions(host, 1);
    expect(checkContent(actor.checker('article'))('read', { locale: 'en' }, 'secret')).toBe(false);
  });
});

it('checks conditional create permission against the recorded creator', () => {
  expect(() =>
    authorizeDocument({
      pluginAllowed: true,
      source,
      target: null,
      targetLocale: 'fr',
      fields: ['title'],
      createMissingLocales: true,
      publish: false,
      creationActorId: 7,
      can: (action, entity) =>
        action !== 'create' ||
        (typeof entity.createdBy === 'object' &&
          entity.createdBy !== null &&
          'id' in entity.createdBy &&
          entity.createdBy.id === 7),
    })
  ).not.toThrow();
});

it('does not accept truthy non-boolean plugin permission results', async () => {
  const fixture = persistenceFixture();
  await fixture.host.db.query('admin::user').create({ data: { isActive: true } });
  const host = {
    ...fixture.host,
    service: () => ({ engine: { generateUserAbility: async () => ({ can: () => 'true' }) } }),
    plugin: () => ({ service: () => ({ create: () => ({ can: () => true }) }) }),
  };
  expect((await loadActorPermissions(host, 1)).plugin('translate')).toBe(false);
});
it('does not accept truthy non-boolean content permission results', async () => {
  const fixture = persistenceFixture();
  await fixture.host.db.query('admin::user').create({ data: { isActive: true } });
  const host = {
    ...fixture.host,
    service: () => ({ engine: { generateUserAbility: async () => ({ can: () => true }) } }),
    plugin: () => ({ service: () => ({ create: () => ({ can: () => ({ allowed: true }) }) }) }),
  };
  const actor = await loadActorPermissions(host, 1);
  expect(checkContent(actor.checker('article'))('read', { locale: 'en' })).toBe(false);
});
