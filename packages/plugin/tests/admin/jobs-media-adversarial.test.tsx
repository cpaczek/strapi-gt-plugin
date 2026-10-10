// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { JobTable } from '../../admin/src/components/JobTable';
import { MediaEditor } from '../../admin/src/components/MediaEditor';
import type { MediaOverlayItem } from '../../shared/contracts';
import { messages } from '../../shared/messages';
import { renderAdmin } from './render';
import { failedJob } from './fixtures';

afterEach(cleanup);
const item: MediaOverlayItem = {
  path: ['sections', 0, 'cover'],
  assetId: '7',
  property: 'caption',
  source: 'Harbor',
  value: 'Port',
  status: 'translated',
};
const mountMedia = (items: MediaOverlayItem[] = [item], draftAndPublish = true, busy = false) => {
  const save = vi.fn();
  renderAdmin(
    <MediaEditor
      response={{ items, draftAndPublish }}
      model="api::article.article"
      documentId="one"
      locale="ar"
      busy={busy}
      readOnly={false}
      onSave={save}
    />
  );
  return save;
};
describe('job and metadata boundaries', () => {
  it('has a useful empty history state', () => {
    renderAdmin(<JobTable jobs={[]} busy={false} />);
    expect(screen.getByText(/No translation jobs yet/)).toBeTruthy();
  });
  it('hides retry from users without translation rights', () => {
    renderAdmin(<JobTable jobs={[failedJob]} busy={false} />);
    expect(screen.queryByRole('button', { name: /Retry/ })).toBeNull();
  });
  it('keeps active jobs out of retry actions', () => {
    renderAdmin(
      <JobTable
        jobs={['queued', 'running', 'waiting'].map((status, index) => ({
          ...failedJob,
          id: index + 1,
          status: status === 'queued' ? 'queued' : status === 'running' ? 'running' : 'waiting',
        }))}
        onRetry={vi.fn()}
        busy={false}
      />
    );
    expect(screen.queryByRole('button', { name: /Retry/ })).toBeNull();
  });
  it('disables retry while another write is pending', () => {
    renderAdmin(<JobTable jobs={[failedJob]} busy onRetry={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Retry job 1' }).hasAttribute('disabled')).toBe(true);
  });
  it('shows partial job failures alongside successes', () => {
    renderAdmin(
      <JobTable
        jobs={[
          { ...failedJob, error: messages.quotaExhausted() },
          { ...failedJob, id: 2, targetLocale: 'ar', status: 'succeeded' },
        ]}
        busy={false}
      />
    );
    expect(screen.getByText('Succeeded')).toBeTruthy();
    expect(screen.getByText(messages.quotaExhausted().text)).toBeTruthy();
  });
  it('requires explicit retry consent for interrupted paid requests', () => {
    const retry = vi.fn();
    renderAdmin(
      <JobTable
        jobs={[
          {
            ...failedJob,
            error: { ...messages.networkFailure('Safe fixture'), code: 'interrupted-request' },
          },
        ]}
        busy={false}
        onRetry={retry}
      />
    );
    expect(screen.getByRole('button', { name: 'Retry job 1' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'I checked GT and accept retrying job 1' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry job 1' }));
    expect(retry).toHaveBeenCalledWith(1);
  });
  it('shows empty metadata with the next step', () => {
    mountMedia([]);
    expect(screen.getByText(/No eligible media metadata/)).toBeTruthy();
  });
  it('distinguishes null from empty strings when saving', () => {
    const save = mountMedia();
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Use null for caption: sections.0.cover' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save caption: sections.0.cover' }));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ value: null, reset: false, path: ['sections', 0, 'cover'] })
    );
  });
  it('preserves the index for duplicate media occurrences', () => {
    const save = mountMedia([item, { ...item, path: ['sections', 1, 'cover'] }]);
    fireEvent.click(screen.getByRole('button', { name: 'Reset caption: sections.1.cover' }));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ path: ['sections', 1, 'cover'], reset: true })
    );
  });
  it('retains unusual Unicode and RTL text without HTML interpretation', () => {
    const save = mountMedia();
    fireEvent.change(screen.getByRole('textbox', { name: 'Localized caption: sections.0.cover' }), {
      target: { value: '<b>عالم Minecraft</b> 🧱' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save caption: sections.0.cover' }));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ value: '<b>عالم Minecraft</b> 🧱' })
    );
    expect(document.querySelector('b')).toBeNull();
  });
  it('explains that nondraft metadata becomes visible immediately', () => {
    mountMedia([item], false);
    expect(screen.getByText(/Metadata edits are visible immediately/)).toBeTruthy();
  });
  it('disables every metadata mutation while saving', () => {
    mountMedia([item], true, true);
    expect(
      screen
        .getByRole('button', { name: 'Reset caption: sections.0.cover' })
        .hasAttribute('disabled')
    ).toBe(true);
    expect(
      screen
        .getByRole('textbox', { name: 'Localized caption: sections.0.cover' })
        .hasAttribute('disabled')
    ).toBe(true);
  });
});
