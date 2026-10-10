// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, fireEvent } from '@testing-library/react';
import { SettingsForm } from '../../admin/src/components/SettingsForm';
import { renderAdmin } from './render';
import { settingsResponse } from './fixtures';

afterEach(cleanup);
describe('settings editor', () => {
  it('shows environment-only masked credentials and no editable API key', () => {
    renderAdmin(
      <SettingsForm response={settingsResponse} canWrite onSave={vi.fn()} saving={false} />
    );
    expect(screen.getByText(/GT_API_KEY/)).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'API key' })).toBeNull();
    expect(screen.getByText('********')).toBeTruthy();
  });
  it('saves project and nested field context without replacing other settings', () => {
    const save = vi.fn();
    renderAdmin(<SettingsForm response={settingsResponse} canWrite onSave={save} saving={false} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Project ID' }), {
      target: { value: 'newsroom' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Context for section.heading' }), {
      target: { value: 'A short section heading' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'newsroom',
        sourceLocale: 'en',
        targetLocales: ['fr', 'ar'],
        contentTypes: {
          'api::article.article': expect.objectContaining({
            fields: expect.objectContaining({
              'section.heading': { translate: true, context: 'A short section heading' },
            }),
          }),
        },
      })
    );
  });
  it('never offers private or numeric fields for translation', () => {
    renderAdmin(
      <SettingsForm response={settingsResponse} canWrite onSave={vi.fn()} saving={false} />
    );
    expect(screen.queryByRole('checkbox', { name: 'Translate secret' })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'Translate count' })).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Translate title' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Translate section.heading' })).toBeTruthy();
  });
  it('has no save action for a read-only settings user', () => {
    renderAdmin(
      <SettingsForm response={settingsResponse} canWrite={false} onSave={vi.fn()} saving={false} />
    );
    expect(screen.queryByRole('button', { name: 'Save settings' })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Project ID' }).hasAttribute('disabled')).toBe(true);
  });
});
