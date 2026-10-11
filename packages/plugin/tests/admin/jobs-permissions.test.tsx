// @vitest-environment jsdom
import type { StrapiApp } from '@strapi/strapi/admin';
import { act, cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import plugin from '../../admin/src';
import { JobsPage } from '../../admin/src/pages/JobsPage';
import { PERMISSIONS, UI_POLL_MS } from '../../shared/constants';
import { messages } from '../../shared/messages';
import { renderAdmin } from './render';
import { failedJob } from './fixtures';

const host = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  permissions: vi.fn(),
}));
vi.mock('@strapi/strapi/admin', () => ({ useFetchClient: () => host, useRBAC: host.permissions }));
vi.mock('../../admin/src/extensions', () => ({
  TranslateAction: () => null,
  TranslateBulkAction: () => null,
  TranslationPanel: () => null,
}));
const grants = [
  [PERMISSIONS.readSettings, 'canReadSettings'],
  [PERMISSIONS.translate, 'canTranslate'],
  [PERMISSIONS.bulkTranslate, 'canBulkTranslate'],
] as const;
const menu = () => {
  const addMenuLink = vi.fn<StrapiApp['addMenuLink']>();
  const application = {
    addMenuLink,
    addSettingsLink: vi.fn<StrapiApp['addSettingsLink']>(),
    registerPlugin: vi.fn<StrapiApp['registerPlugin']>(),
  };
  Reflect.apply(plugin.register, undefined, [application]);
  const registered = addMenuLink.mock.calls[0]?.[0];
  if (!registered) throw new Error('Expected the Jobs menu registration');
  return registered;
};
beforeEach(() => {
  vi.clearAllMocks();
  host.get.mockResolvedValue({ data: { jobs: [failedJob], total: 1 } });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Jobs navigation permission boundary', () => {
  it('does not offer Jobs for a write-settings-only permission', () => {
    expect(menu().permissions.some(({ action }) => action === PERMISSIONS.writeSettings)).toBe(
      false
    );
  });
  it.each(grants)('offers Jobs for %s', (action) => {
    expect(menu().permissions.some((permission) => permission.action === action)).toBe(true);
  });
  it('does not fetch or poll history when a settings writer opens Jobs directly', async () => {
    vi.useFakeTimers();
    host.permissions.mockReturnValue({
      isLoading: false,
      allowedActions: { canWriteSettings: true },
    });
    renderAdmin(<JobsPage />);
    await act(() => vi.advanceTimersByTimeAsync(UI_POLL_MS * 2));
    expect(host.get).not.toHaveBeenCalled();
    expect(screen.getByText(messages.permissionDenied().text)).toBeTruthy();
  });
  it.each(grants)('loads history for %s', async (_action, allowedAction) => {
    host.permissions.mockReturnValue({
      isLoading: false,
      allowedActions: { [allowedAction]: true },
    });
    renderAdmin(<JobsPage />);
    expect(await screen.findByText(failedJob.documentId)).toBeTruthy();
    expect(host.get).toHaveBeenCalledWith(
      '/general-translation/jobs?page=1',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(screen.queryByRole('button', { name: 'Retry job 1' }) !== null).toBe(
      allowedAction !== 'canReadSettings'
    );
  });
  it.each([
    { isLoading: true, allowedActions: { canTranslate: true } },
    {
      isLoading: false,
      error: new Error('Permission check failed'),
      allowedActions: { canTranslate: true },
    },
    { isLoading: false, allowedActions: {} },
  ])(
    'does not request history before an allowed permission is resolved: %j',
    async (permissions) => {
      vi.useFakeTimers();
      host.permissions.mockReturnValue(permissions);
      renderAdmin(<JobsPage />);
      await act(() => vi.advanceTimersByTimeAsync(UI_POLL_MS * 2));
      expect(host.get).not.toHaveBeenCalled();
    }
  );
});
