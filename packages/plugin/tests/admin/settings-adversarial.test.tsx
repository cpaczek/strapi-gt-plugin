// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsForm } from '../../admin/src/components/SettingsForm';
import { selectableFields } from '../../admin/src/fields';
import type { ContentSchema, SettingsResponse } from '../../shared/contracts';
import { renderAdmin } from './render';
import { settingsResponse } from './fixtures';

afterEach(cleanup);
const mount = (response: SettingsResponse = settingsResponse, saving = false) => {
  const save = vi.fn();
  renderAdmin(<SettingsForm response={response} canWrite saving={saving} onSave={save} />);
  return save;
};
describe('settings boundary cases', () => {
  it('persists the sensible fields shown on an untouched first save', () => {
    const save = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        contentTypes: { 'api::article.article': { fields: {}, mediaMetadata: false } },
      })
    );
  });
  it('removes a deselected target without changing the source', () => {
    const save = mount();
    fireEvent.click(screen.getByRole('checkbox', { name: 'French (fr)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ sourceLocale: 'en', targetLocales: ['ar'] })
    );
  });
  it('keeps an empty context as an explicit editable value', () => {
    const save = mount({
      ...settingsResponse,
      settings: {
        ...settingsResponse.settings,
        contentTypes: {
          'api::article.article': {
            fields: { title: { translate: true, context: 'Old' } },
            mediaMetadata: false,
          },
        },
      },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Context for title' }), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        contentTypes: expect.objectContaining({
          'api::article.article': expect.objectContaining({
            fields: { title: { translate: true, context: '' } },
          }),
        }),
      })
    );
  });
  it('preserves RTL context without normalization', () => {
    const save = mount();
    fireEvent.change(screen.getByRole('textbox', { name: 'Context for title' }), {
      target: { value: 'عنوان لاعب Minecraft' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(save.mock.calls[0]?.[0].contentTypes['api::article.article'].fields.title.context).toBe(
      'عنوان لاعب Minecraft'
    );
  });
  it('disables nested context while the parent component is excluded', () => {
    mount();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Translate section' }));
    expect(
      screen.getByRole('textbox', { name: 'Context for section.heading' }).hasAttribute('disabled')
    ).toBe(true);
  });
  it('UIDs stay excluded until deliberately selected', () => {
    mount();
    expect(
      screen.getByRole('checkbox', { name: 'Translate slug' }).getAttribute('aria-checked')
    ).toBe('false');
  });
  it('saves the displayed title source when regeneration is selected', async () => {
    const user = userEvent.setup();
    const save = mount();
    await user.click(screen.getByRole('checkbox', { name: 'Translate slug' }));
    await user.click(screen.getByRole('combobox', { name: 'UID policy for slug' }));
    await user.click(screen.getByRole('option', { name: 'Generate from translated field' }));
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(save.mock.calls[0]?.[0].contentTypes['api::article.article'].fields.slug).toEqual({
      translate: true,
      uidStrategy: 'regenerate',
      sourceField: 'title',
    });
  });
  it('shows no editable key when the environment key is absent', () => {
    mount({ ...settingsResponse, hasApiKey: false, maskedApiKey: '' });
    expect(screen.getByText('Not configured')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: /key/i })).toBeNull();
  });
  it('shows an empty state when no localized types exist', () => {
    mount({ ...settingsResponse, contentTypes: [] });
    expect(screen.getByText(/No localized content types are available/)).toBeTruthy();
  });
  it('does not accept edits while saving', () => {
    mount(settingsResponse, true);
    expect(screen.getByRole('textbox', { name: 'Project ID' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Save settings' }).hasAttribute('disabled')).toBe(
      true
    );
  });
  it('allows individual media fields only after metadata is enabled', () => {
    const save = mount();
    const mediaField = screen.getByRole('checkbox', { name: 'Translate cover' });
    expect(mediaField.hasAttribute('disabled')).toBe(true);
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'Translate media alt text and captions for api::article.article',
      })
    );
    expect(mediaField.hasAttribute('disabled')).toBe(false);
    fireEvent.click(mediaField);
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(
      save.mock.calls[0]?.[0].contentTypes['api::article.article'].fields.cover.translate
    ).toBe(false);
  });
  it('terminates recursive component schema traversal', () => {
    const schema: ContentSchema = {
      uid: 'a',
      localized: true,
      draftAndPublish: false,
      attributes: { child: { type: 'component', component: 'a', localized: true } },
    };
    expect(selectableFields(schema, { a: schema }).map((row) => row.path)).toEqual(['child']);
  });
  it('deduplicates dynamic-zone common fields and excludes private and nonlocalized leaves', () => {
    const components = {
      a: {
        uid: 'a',
        localized: true,
        draftAndPublish: false,
        attributes: {
          title: { type: 'string' },
          private: { type: 'string', private: true },
          shared: { type: 'text', localized: false },
        },
      },
      b: {
        uid: 'b',
        localized: true,
        draftAndPublish: false,
        attributes: { title: { type: 'string' } },
      },
    } satisfies Record<string, ContentSchema>;
    const schema: ContentSchema = {
      uid: 'root',
      localized: true,
      draftAndPublish: true,
      attributes: { blocks: { type: 'dynamiczone', components: ['a', 'b'], localized: true } },
    };
    expect(selectableFields(schema, components).map((row) => row.path)).toEqual([
      'blocks',
      'blocks.title',
    ]);
  });
});
