// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { SettingsPage } from '../../admin/src/pages/SettingsPage';
import { renderAdmin } from './render';
import { settingsResponse } from './fixtures';
import { messages } from '../../shared/messages';

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
  host.get.mockResolvedValue({ data: settingsResponse });
  host.permissions.mockReturnValue({
    allowedActions: { canReadSettings: true, canWriteSettings: true },
    isLoading: false,
    permissions: [],
  });
});
describe('settings page requests', () => {
  it('shows returned project identity and locales after testing the saved connection', async () => {
    host.post.mockResolvedValue({
      data: {
        project: { id: 'editorial', name: 'Ender Post', sourceLocale: 'en', locales: ['fr', 'ar'] },
        message: messages.connectionSuccess(),
      },
    });
    renderAdmin(<SettingsPage />);
    await screen.findByRole('textbox', { name: 'Project ID' });
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText('Connected project: Ender Post (editorial)')).toBeTruthy();
    expect(screen.getByText('Project locales: en, fr, ar')).toBeTruthy();
    expect(host.post).toHaveBeenCalledWith('/general-translation/connection', {});
  });
  it('shows sanitized connection failure and keeps the retry action', async () => {
    host.post.mockRejectedValue({ response: { data: { error: messages.invalidKey() } } });
    renderAdmin(<SettingsPage />);
    await screen.findByRole('textbox', { name: 'Project ID' });
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText(messages.invalidKey().text)).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Test connection' }).hasAttribute('disabled')).toBe(
        false
      )
    );
  });
  it('does not fetch settings for a translate-only account', () => {
    host.permissions.mockReturnValue({
      allowedActions: { canTranslate: true },
      isLoading: false,
      permissions: [],
    });
    renderAdmin(<SettingsPage />);
    expect(host.get).not.toHaveBeenCalled();
    expect(screen.getByText(messages.permissionDenied().text)).toBeTruthy();
  });
});
