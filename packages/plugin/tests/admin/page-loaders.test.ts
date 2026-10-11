import type { StrapiApp } from '@strapi/strapi/admin';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const evaluated = vi.hoisted(() => ({ settings: vi.fn(), jobs: vi.fn() }));
vi.mock('@strapi/icons', () => ({ Earth: () => null }));
vi.mock('../../admin/src/extensions', () => ({
  TranslateAction: () => null,
  TranslateBulkAction: () => null,
  TranslationPanel: () => null,
}));
vi.mock('../../admin/src/pages/SettingsPage', () => {
  evaluated.settings();
  return { SettingsPage: () => null };
});
vi.mock('../../admin/src/pages/JobsPage', () => {
  evaluated.jobs();
  return { JobsPage: () => null };
});
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});
const registeredLoaders = async () => {
  const { default: plugin } = await import('../../admin/src');
  const addSettingsLink = vi.fn<StrapiApp['addSettingsLink']>();
  const addMenuLink = vi.fn<StrapiApp['addMenuLink']>();
  Reflect.apply(plugin.register, undefined, [
    {
      registerPlugin: vi.fn<StrapiApp['registerPlugin']>(),
      addSettingsLink,
      addMenuLink,
    },
  ]);
  const settings = addSettingsLink.mock.calls[0]?.[1];
  const jobs = addMenuLink.mock.calls[0]?.[0];
  if (!settings || Array.isArray(settings) || !settings.Component || !jobs?.Component)
    throw new Error('Expected settings and Jobs route loaders');
  return { settings: settings.Component, jobs: jobs.Component };
};

describe('public Strapi route loader contract', () => {
  it.each(['settings', 'jobs'] as const)(
    'registers %s without the deprecated async wrapper',
    async (page) => {
      const loaders = await registeredLoaders();
      expect(Object.prototype.toString.call(loaders[page])).toBe('[object Function]');
    }
  );
  it('defers page evaluation and resolves the requested named export as default', async () => {
    const loaders = await registeredLoaders();
    expect(evaluated.settings).not.toHaveBeenCalled();
    expect(evaluated.jobs).not.toHaveBeenCalled();
    const settings = loaders.settings();
    expect(settings).toBeInstanceOf(Promise);
    expect(await settings).toEqual({ default: expect.any(Function) });
    expect(evaluated.settings).toHaveBeenCalledOnce();
    expect(evaluated.jobs).not.toHaveBeenCalled();
    expect(await loaders.jobs()).toEqual({ default: expect.any(Function) });
    expect(evaluated.jobs).toHaveBeenCalledOnce();
  });
});
