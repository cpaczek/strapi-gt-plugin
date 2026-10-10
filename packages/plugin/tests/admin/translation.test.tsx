// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, fireEvent } from '@testing-library/react';
import { TranslationComposer } from '../../admin/src/components/TranslationComposer';
import { renderAdmin } from './render';
import { options } from './fixtures';

afterEach(cleanup);
describe('translation selection', () => {
  it('queues the chosen target locale for the saved document', () => {
    const queue = vi.fn();
    renderAdmin(
      <TranslationComposer
        options={options}
        model="api::article.article"
        documentIds={['article-one']}
        onQueue={queue}
        busy={false}
      />
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Arabic (ar)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Translate' }));
    expect(queue).toHaveBeenCalledWith({
      contentType: 'api::article.article',
      documentIds: ['article-one'],
      targetLocales: ['fr'],
      force: false,
    });
  });
  it('requires explicit consent before forcing human edits', () => {
    const queue = vi.fn();
    renderAdmin(
      <TranslationComposer
        options={options}
        model="api::article.article"
        documentIds={['article-one']}
        onQueue={queue}
        busy={false}
      />
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Force retranslate' }));
    expect(screen.getByRole('button', { name: 'Force retranslate' }).hasAttribute('disabled')).toBe(
      true
    );
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'I reviewed the target content and accept replacing human edits',
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Force retranslate' }));
    expect(queue).toHaveBeenCalledWith(expect.objectContaining({ force: true }));
  });
  it('does not queue without targets or a saved document', () => {
    renderAdmin(
      <TranslationComposer
        options={options}
        model="api::article.article"
        documentIds={[]}
        onQueue={vi.fn()}
        busy={false}
      />
    );
    expect(screen.getByRole('button', { name: 'Translate' }).hasAttribute('disabled')).toBe(true);
  });
  it('warns when another automatic translator is enabled', () => {
    renderAdmin(
      <TranslationComposer
        options={{ ...options, aiTranslationsEnabled: true }}
        model="api::article.article"
        documentIds={['article-one']}
        onQueue={vi.fn()}
        busy={false}
      />
    );
    expect(screen.getByText(/Both translation systems can update the same locales/)).toBeTruthy();
  });
});
