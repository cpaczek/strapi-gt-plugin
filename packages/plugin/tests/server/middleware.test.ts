import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/constants';
import type { PluginSettings } from '../../shared/contracts';

const mocks = vi.hoisted(() => ({
  enqueue: vi.fn(async () => ({ jobs: [] })),
  decorate: vi.fn(async (value: unknown) => value),
  savedSettings: vi.fn(),
  state: vi.fn(async () => ({ checkpoints: {}, media: [], appliedJob: null })),
  saveState: vi.fn(),
  deleteState: vi.fn(),
}));
vi.mock('../../server/src/runtime', () => ({
  createPluginRuntime: () => ({
    savedSettings: mocks.savedSettings,
    schemaFor: () => ({
      schema: {
        uid: 'api::article.article',
        localized: true,
        draftAndPublish: true,
        attributes: {},
      },
      components: {},
    }),
    media: { decorate: mocks.decorate },
    repository: { state: mocks.state, saveState: mocks.saveState, deleteState: mocks.deleteState },
    enqueue: mocks.enqueue,
  }),
}));
import plugin from '../../server/src';

const settings: PluginSettings = {
  ...DEFAULT_SETTINGS,
  targetLocales: ['fr'],
  automaticMode: 'save',
  contentTypes: { 'api::article.article': { fields: {}, mediaMetadata: true } },
};
type DocumentMiddleware = (
  context: { uid: string; action: string; params: Record<string, unknown> },
  next: () => Promise<unknown>
) => Promise<unknown>;
const isMiddleware = (value: unknown): value is DocumentMiddleware => typeof value === 'function';
const install = (request: unknown) => {
  let middleware: DocumentMiddleware | undefined;
  const log = vi.fn();
  const host = {
    documents: {
      use: (value: unknown) => {
        if (!isMiddleware(value)) throw new Error('Expected middleware');
        middleware = value;
      },
    },
    db: { transaction: async (callback: () => Promise<unknown>) => callback() },
    localization: { getDefaultLocale: async () => 'en' },
    requestContext: { get: () => request },
    log: { warn: log },
  };
  Reflect.apply(plugin.register, undefined, [{ strapi: host }]);
  if (!middleware) throw new Error('Middleware was not registered');
  return { middleware, log };
};
const adminRequest = {
  method: 'PUT',
  state: {
    route: { info: { type: 'admin' } },
    user: { id: 1 },
    session: { id: 'session' },
    userAbility: { can: () => true },
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.savedSettings.mockResolvedValue(settings);
});
describe('Document Service middleware authority', () => {
  it('never promotes a Content API user ID into an admin actor', async () => {
    const { middleware } = install({
      method: 'PUT',
      state: { route: { info: { type: 'content-api' } }, user: { id: 1 } },
    });
    await middleware(
      { uid: 'api::article.article', action: 'update', params: { locale: 'en' } },
      async () => ({ documentId: 'doc', locale: 'en' })
    );
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it('requires an authenticated admin session for automatic work', async () => {
    const { middleware } = install({
      method: 'PUT',
      state: { route: { info: { type: 'admin' } }, user: { id: 1 } },
    });
    await middleware(
      { uid: 'api::article.article', action: 'update', params: { locale: 'en' } },
      async () => ({ documentId: 'doc', locale: 'en' })
    );
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it('enqueues a successful source save by its admin actor', async () => {
    const { middleware } = install(adminRequest);
    const result = { documentId: 'doc', locale: 'en' };
    expect(
      await middleware(
        { uid: 'api::article.article', action: 'update', params: { locale: 'en' } },
        async () => result
      )
    ).toBe(result);
    expect(mocks.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ documentIds: ['doc'], force: false }),
      1,
      'translate',
      'draft'
    );
  });
  it('does not enqueue after a failed save', async () => {
    const { middleware } = install(adminRequest);
    await expect(
      middleware({ uid: 'api::article.article', action: 'update', params: {} }, async () => {
        throw new Error('Save failed');
      })
    ).rejects.toThrow('Save failed');
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it('does not enqueue a target-locale save', async () => {
    const { middleware } = install(adminRequest);
    await middleware(
      { uid: 'api::article.article', action: 'update', params: { locale: 'fr' } },
      async () => ({ documentId: 'doc', locale: 'fr' })
    );
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it('promotes only locales actually published', async () => {
    const { middleware } = install(adminRequest);
    await middleware(
      { uid: 'api::article.article', action: 'publish', params: { documentId: 'doc' } },
      async () => ({ entries: [{ documentId: 'doc', locale: 'en' }] })
    );
    expect(mocks.saveState).toHaveBeenCalledOnce();
    expect(mocks.saveState).toHaveBeenCalledWith(
      'api::article.article',
      'doc',
      'en',
      'published',
      expect.any(Object)
    );
  });
  it('never decorates ordinary Content Manager reads', async () => {
    const { middleware } = install({ ...adminRequest, method: 'GET' });
    await middleware({ uid: 'api::article.article', action: 'findOne', params: {} }, async () => ({
      documentId: 'doc',
    }));
    expect(mocks.decorate).not.toHaveBeenCalled();
  });
  it('includes single-type Content API reads', async () => {
    const { middleware } = install({
      method: 'GET',
      state: { route: { info: { type: 'content-api' } } },
    });
    await middleware(
      { uid: 'api::article.article', action: 'findFirst', params: {} },
      async () => ({ documentId: 'doc' })
    );
    expect(mocks.decorate).toHaveBeenCalledOnce();
  });
});
