// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { TranslationComposer } from '../../admin/src/components/TranslationComposer';
import { MAX_DOCUMENTS_PER_REQUEST } from '../../shared/constants';
import type { TranslationOptionsResponse } from '../../shared/contracts';
import { renderAdmin } from './render';
import { options } from './fixtures';

afterEach(cleanup);
const mount = (
  settings: TranslationOptionsResponse = options,
  ids = ['one'],
  busy = false,
  bulk = false
) => {
  const queue = vi.fn();
  renderAdmin(
    <TranslationComposer
      options={settings}
      model="api::article.article"
      documentIds={ids}
      busy={busy}
      bulk={bulk}
      onQueue={queue}
    />
  );
  return queue;
};
describe('translation adversarial cases', () => {
  it('deduplicates selected documents', () => {
    const queue = mount(options, ['one', 'one', 'two'], false, true);
    fireEvent.click(screen.getByRole('button', { name: 'Translate selected' }));
    expect(queue).toHaveBeenCalledWith(expect.objectContaining({ documentIds: ['one', 'two'] }));
  });
  it('does not queue more documents than the server permits', () => {
    mount(
      options,
      Array.from({ length: MAX_DOCUMENTS_PER_REQUEST + 1 }, (_, index) => String(index))
    );
    expect(screen.getByRole('button', { name: 'Translate' }).hasAttribute('disabled')).toBe(true);
  });
  it('disables submission after all target locales are unchecked', () => {
    mount();
    fireEvent.click(screen.getByRole('checkbox', { name: 'French (fr)' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Arabic (ar)' }));
    expect(screen.getByRole('button', { name: 'Translate' }).hasAttribute('disabled')).toBe(true);
  });
  it('does not queue an unconfigured connection', () => {
    mount({ ...options, configured: false });
    expect(screen.getByRole('button', { name: 'Translate' }).hasAttribute('disabled')).toBe(true);
  });
  it('does not queue an unconfigured content type', () => {
    mount({ ...options, contentTypes: [] });
    expect(screen.getByRole('button', { name: 'Translate' }).hasAttribute('disabled')).toBe(true);
  });
  it('does not queue a nonlocalized content type', () => {
    mount({
      ...options,
      contentTypes: [{ uid: 'api::article.article', localized: false, draftAndPublish: true }],
    });
    expect(screen.getByRole('button', { name: 'Translate' }).hasAttribute('disabled')).toBe(true);
  });
  it('does not offer the source locale as a target', () => {
    mount({
      ...options,
      targetLocales: [...options.targetLocales, { code: 'en', name: 'English' }],
    });
    expect(screen.queryByRole('checkbox', { name: 'English (en)' })).toBeNull();
  });
  it('clears force consent when the force mode is turned off and back on', () => {
    mount();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Force retranslate' }));
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'I reviewed the target content and accept replacing human edits',
      })
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Force retranslate' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Force retranslate' }));
    expect(screen.getByRole('button', { name: 'Force retranslate' }).hasAttribute('disabled')).toBe(
      true
    );
  });
  it('requires fresh consent after changing the selected targets', () => {
    mount();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Force retranslate' }));
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'I reviewed the target content and accept replacing human edits',
      })
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'French (fr)' }));
    expect(screen.getByRole('button', { name: 'Force retranslate' }).hasAttribute('disabled')).toBe(
      true
    );
  });
  it('warns about immediate publication on nondraft content', () => {
    mount({
      ...options,
      contentTypes: [{ uid: 'api::article.article', localized: true, draftAndPublish: false }],
    });
    expect(screen.getByText(/Saved translations are visible immediately/)).toBeTruthy();
  });
  it('explains missing locale creation when disabled', () => {
    mount({ ...options, createMissingLocales: false });
    expect(screen.getByText(/Create missing target locales in Content Manager/)).toBeTruthy();
  });
  it('keeps disabled target controls while queue submission is pending', () => {
    mount(options, ['one'], true);
    expect(screen.getByRole('checkbox', { name: 'French (fr)' }).hasAttribute('disabled')).toBe(
      true
    );
    expect(screen.getByRole('button', { name: 'Translate' }).hasAttribute('disabled')).toBe(true);
  });
  it('renders RTL locale names as text and preserves the exact locale identifier', () => {
    const queue = mount({ ...options, targetLocales: [{ code: 'ar', name: 'العربية' }] });
    expect(screen.getByRole('checkbox', { name: 'العربية (ar)' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Translate' }));
    expect(queue).toHaveBeenCalledWith(expect.objectContaining({ targetLocales: ['ar'] }));
  });
});
