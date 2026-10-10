// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { JobsPage } from '../../admin/src/pages/JobsPage';
import { renderAdmin } from './render';
import { failedJob } from './fixtures';

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
  host.permissions.mockReturnValue({
    allowedActions: { canTranslate: true },
    isLoading: false,
    permissions: [],
  });
});

describe('history counts after current content authorization', () => {
  it('does not describe a filtered page as an empty job history', async () => {
    host.get.mockResolvedValue({ data: { jobs: [], total: 7 } });
    renderAdmin(<JobsPage />);
    await screen.findByRole('button', { name: 'Next page' });
    expect(screen.queryByText(/No translation jobs yet/)).toBeNull();
    expect(screen.getByText('7 recorded jobs')).toBeTruthy();
  });
  it('keeps pagination through an empty filtered page so later readable records remain reachable', async () => {
    host.get.mockImplementation((path: string) =>
      Promise.resolve({ data: { jobs: path.includes('page=2') ? [failedJob] : [], total: 26 } })
    );
    renderAdmin(<JobsPage />);
    const next = await screen.findByRole('button', { name: 'Next page' });
    expect(next.hasAttribute('disabled')).toBe(false);
    fireEvent.click(next);
    expect(await screen.findByText(failedJob.documentId)).toBeTruthy();
    expect(screen.getByText('Page 2')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next page' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Previous page' }).hasAttribute('disabled')).toBe(
      false
    );
    expect(host.get).toHaveBeenCalledWith(
      '/general-translation/jobs?page=2',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });
  it('retains first-job guidance only when no records exist', async () => {
    host.get.mockResolvedValue({ data: { jobs: [], total: 0 } });
    renderAdmin(<JobsPage />);
    expect(await screen.findByText(/No translation jobs yet/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next page' }).hasAttribute('disabled')).toBe(true);
  });
});
