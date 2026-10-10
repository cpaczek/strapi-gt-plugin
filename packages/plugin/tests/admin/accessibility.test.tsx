// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { SettingsPage } from '../../admin/src/pages/SettingsPage';
import { JobsPage } from '../../admin/src/pages/JobsPage';
import { renderAdmin } from './render';
import { settingsResponse } from './fixtures';

const host = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  permissions: vi.fn(),
}));
vi.mock('@strapi/strapi/admin', () => ({ useFetchClient: () => host, useRBAC: host.permissions }));
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  host.get.mockImplementation((path: string) =>
    Promise.resolve({ data: path.includes('/jobs') ? { jobs: [], total: 0 } : settingsResponse })
  );
  host.permissions.mockReturnValue({
    allowedActions: { canReadSettings: true, canWriteSettings: true },
    isLoading: false,
    permissions: [],
  });
});
const expectSkipTarget = (name: string) => {
  const main = screen.getByRole('main', { name });
  expect(main.id).toBe('main-content');
  expect(main.tabIndex).toBe(-1);
  main.focus();
  expect(document.activeElement).toBe(main);
};
describe('admin page landmarks', () => {
  it('makes the settings content reachable by the host skip link', async () => {
    renderAdmin(<SettingsPage />);
    await screen.findByRole('textbox', { name: 'Project ID' });
    expectSkipTarget('General Translation');
  });
  it('retains the settings landmark while loading permissions', () => {
    host.permissions.mockReturnValue({ allowedActions: {}, isLoading: true, permissions: [] });
    renderAdmin(<SettingsPage />);
    expectSkipTarget('General Translation');
  });
  it('retains the settings landmark when permission is denied', () => {
    host.permissions.mockReturnValue({ allowedActions: {}, isLoading: false, permissions: [] });
    renderAdmin(<SettingsPage />);
    expectSkipTarget('General Translation');
  });
  it('makes job history reachable by the host skip link', async () => {
    renderAdmin(<JobsPage />);
    await screen.findByText(/No translation jobs yet/);
    expectSkipTarget('Job history');
  });
});
