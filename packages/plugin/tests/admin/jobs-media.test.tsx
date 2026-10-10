// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, fireEvent } from '@testing-library/react';
import { JobTable } from '../../admin/src/components/JobTable';
import { MediaEditor } from '../../admin/src/components/MediaEditor';
import { renderAdmin } from './render';
import { failedJob } from './fixtures';
import { messages } from '../../shared/messages';

afterEach(cleanup);
describe('jobs and localized metadata', () => {
  it('displays actionable diagnostic and retries the failed job', () => {
    const retry = vi.fn();
    renderAdmin(
      <JobTable
        jobs={[{ ...failedJob, error: messages.invalidKey() }]}
        onRetry={retry}
        busy={false}
      />
    );
    expect(screen.getByText(messages.invalidKey().text)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry job 1' }));
    expect(retry).toHaveBeenCalledWith(1);
  });
  it('does not offer retries for successful jobs', () => {
    renderAdmin(
      <JobTable jobs={[{ ...failedJob, status: 'succeeded' }]} onRetry={vi.fn()} busy={false} />
    );
    expect(screen.queryByRole('button', { name: 'Retry job 1' })).toBeNull();
  });
  it('saves an intentionally empty localized caption and can reset it', () => {
    const save = vi.fn();
    renderAdmin(
      <MediaEditor
        response={{
          draftAndPublish: true,
          items: [
            {
              path: ['cover'],
              assetId: '7',
              property: 'caption',
              source: 'Harbor',
              value: 'Port',
              status: 'translated',
            },
          ],
        }}
        model="api::article.article"
        documentId="article-one"
        locale="fr"
        readOnly={false}
        busy={false}
        onSave={save}
      />
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Localized caption: cover' }), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save caption: cover' }));
    expect(save).toHaveBeenCalledWith({
      contentType: 'api::article.article',
      documentId: 'article-one',
      locale: 'fr',
      path: ['cover'],
      property: 'caption',
      value: '',
      reset: false,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reset caption: cover' }));
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ reset: true }));
  });
  it('does not expose writes to published metadata', () => {
    renderAdmin(
      <MediaEditor
        response={{
          draftAndPublish: true,
          items: [
            {
              path: ['cover'],
              assetId: '7',
              property: 'alternativeText',
              source: null,
              value: null,
              status: 'source',
            },
          ],
        }}
        model="api::article.article"
        documentId="article-one"
        locale="fr"
        readOnly
        busy={false}
        onSave={vi.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: /Save/ })).toBeNull();
  });
});
