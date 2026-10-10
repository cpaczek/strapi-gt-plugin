import { describe, expect, it } from 'vitest';
import plugin from '../../server/src';
import { PERMISSIONS } from '../../shared/constants';

const permit = (actions: string[], granted: string[]) =>
  Reflect.apply(plugin.policies.permission, undefined, [
    { state: { userAbility: { can: (action: string) => granted.includes(action) } } },
    { actions },
    {},
  ]);
describe('Strapi server boundary', () => {
  it('registers only authenticated admin routes', () => {
    expect(plugin.routes.admin.type).toBe('admin');
    for (const route of plugin.routes.admin.routes) {
      expect(route.config?.auth).not.toBe(false);
      expect(route.config?.policies).toHaveLength(1);
    }
  });
  it('denies requests lacking any configured action', () =>
    expect(permit([PERMISSIONS.translate], [])).toBe(false));
  it('does not infer translate access from settings access', () =>
    expect(permit([PERMISSIONS.translate], [PERMISSIONS.readSettings])).toBe(false));
  it('allows the explicitly configured action', () =>
    expect(permit([PERMISSIONS.translate], [PERMISSIONS.translate])).toBe(true));
  it('fails closed without a user ability', () =>
    expect(
      Reflect.apply(plugin.policies.permission, undefined, [
        { state: {} },
        { actions: [PERMISSIONS.translate] },
        {},
      ])
    ).toBe(false));
  it('keeps translation options separate from settings read', () => {
    const options = plugin.routes.admin.routes.find(
      (route) => route.path === '/translation-options'
    );
    expect(options?.config?.policies).toEqual([
      {
        name: 'plugin::general-translation.permission',
        config: { actions: [PERMISSIONS.translate, PERMISSIONS.bulkTranslate] },
      },
    ]);
  });
  it('allows a loopback recording provider', () =>
    expect(() => plugin.config.validator({ baseUrl: 'http://127.0.0.1:8123' })).not.toThrow());
  it('requires HTTPS outside local test servers', () =>
    expect(() => plugin.config.validator({ baseUrl: 'http://example.org' })).toThrow());
  it('rejects credentials embedded in the provider URL', () =>
    expect(() =>
      plugin.config.validator({ baseUrl: 'https://user:secret@example.org' })
    ).toThrow());
  it('rejects keys in plugin configuration', () =>
    expect(() =>
      plugin.config.validator({ baseUrl: 'https://api.gtx.dev', apiKey: 'sensitive' })
    ).toThrow());
  it('hides internal collections from editor screens', () => {
    for (const type of Object.values(plugin.contentTypes))
      expect(type.schema.pluginOptions['content-manager'].visible).toBe(false);
  });
  it('defines a database-unique lease identity', () =>
    expect(plugin.contentTypes.lease.schema.attributes.key.unique).toBe(true));
});
