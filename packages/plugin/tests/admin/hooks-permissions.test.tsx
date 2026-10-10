// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor, screen } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { useMutation, useResource } from '../../admin/src/hooks';
import { TranslateAction, TranslateBulkAction, TranslationPanel } from '../../admin/src/extensions';
import { DocumentPanel } from '../../admin/src/components/DocumentPanel';
import { renderAdmin } from './render';
import { isContentManagerApi } from '../../admin/src/index';
import { messages } from '../../shared/messages';
import { options } from './fixtures';

const host = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  permissions: vi.fn(),
  layout: vi.fn(),
}));
vi.mock('@strapi/strapi/admin', () => ({ useFetchClient: () => host, useRBAC: host.permissions }));
vi.mock('@strapi/content-manager/strapi-admin', () => ({
  unstable_useDocumentLayout: host.layout,
}));
const wrapper = ({ children }: { children: ReactNode }) => (
  <IntlProvider locale="en">{children}</IntlProvider>
);
const schema = z.object({ name: z.string() });
const context = {
  model: 'api::article.article',
  documentId: 'one',
  activeTab: 'draft',
  collectionType: 'collection-types',
} as const;
const pending = <T,>() => {
  let complete: (value: T) => void = () => {
    throw new Error('Promise resolver not initialized');
  };
  const promise = new Promise<T>((resolve) => {
    complete = resolve;
  });
  return { promise, complete };
};
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  host.get.mockResolvedValue({ data: options });
  host.layout.mockReturnValue({
    isLoading: false,
    list: { options: { i18n: { localized: true } } },
  });
  host.permissions.mockReturnValue({
    allowedActions: { canTranslate: true, canBulkTranslate: true },
    isLoading: false,
    permissions: [],
  });
});
describe('bulk action eligibility from the loaded native layout', () => {
  const selection = {
    model: context.model,
    collectionType: 'collection-types',
    documents: [{ documentId: 'one' }],
  };
  it('exposes the eligible action before GT option metadata resolves', () => {
    host.get.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => TranslateBulkAction(selection), { wrapper });
    expect(result.current?.label).toBe('Translate selected');
    expect(host.get).not.toHaveBeenCalled();
  });
  it('uses the current model for the public layout hook', () => {
    renderHook(() => TranslateBulkAction(selection), { wrapper });
    expect(host.layout).toHaveBeenCalledWith(context.model);
  });
  it.each([false, 'true', undefined])('does not infer localization from %s', (localized) => {
    host.layout.mockReturnValue({ isLoading: false, list: { options: { i18n: { localized } } } });
    const { result } = renderHook(() => TranslateBulkAction(selection), { wrapper });
    expect(result.current).toBeNull();
    expect(host.get).not.toHaveBeenCalled();
  });
  it('hides the action when the layout has no i18n configuration', () => {
    host.layout.mockReturnValue({ isLoading: false, list: { options: {} } });
    const { result } = renderHook(() => TranslateBulkAction(selection), { wrapper });
    expect(result.current).toBeNull();
    expect(host.get).not.toHaveBeenCalled();
  });
  it('hides the action while the native layout is loading', () => {
    host.layout.mockReturnValue({
      isLoading: true,
      list: { options: { i18n: { localized: true } } },
    });
    const { result } = renderHook(() => TranslateBulkAction(selection), { wrapper });
    expect(result.current).toBeNull();
    expect(host.get).not.toHaveBeenCalled();
  });
  it('hides the action after a native layout error', () => {
    host.layout.mockReturnValue({
      isLoading: false,
      error: { name: 'Layout failure' },
      list: { options: { i18n: { localized: true } } },
    });
    const { result } = renderHook(() => TranslateBulkAction(selection), { wrapper });
    expect(result.current).toBeNull();
    expect(host.get).not.toHaveBeenCalled();
  });
  it('does not bypass a pending permission check', () => {
    host.permissions.mockReturnValue({
      isLoading: true,
      allowedActions: { canBulkTranslate: true },
    });
    const { result } = renderHook(() => TranslateBulkAction(selection), { wrapper });
    expect(result.current).toBeNull();
  });
  it('updates eligibility when selecting a different model', () => {
    const { result, rerender } = renderHook(
      ({ model }) => TranslateBulkAction({ ...selection, model }),
      {
        initialProps: { model: context.model },
        wrapper,
      }
    );
    expect(result.current?.label).toBe('Translate selected');
    host.layout.mockReturnValue({ isLoading: false, list: { options: {} } });
    rerender({ model: 'api::category.category' });
    expect(result.current).toBeNull();
  });
});
describe('host permission and request behavior', () => {
  it('does not request protected data when access is disabled', () => {
    renderHook(() => useResource(null, schema));
    expect(host.get).not.toHaveBeenCalled();
  });
  it('shows initial loading and exposes a validated response', async () => {
    host.get.mockResolvedValue({ data: { name: 'Result' } });
    const { result } = renderHook(() => useResource('/example', schema));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.result).toEqual({ name: 'Result' }));
  });
  it('keeps a failed load actionable without displaying raw response text', async () => {
    host.get.mockRejectedValue(new Error('credential-fixture'));
    const { result } = renderHook(() => useResource('/example', schema));
    await waitFor(() => expect(result.current.error).toEqual(messages.adminRequestFailure()));
  });
  it('ignores stale responses after the document changes', async () => {
    const earlier = pending<{ data: { name: string } }>();
    host.get
      .mockReturnValueOnce(earlier.promise)
      .mockResolvedValueOnce({ data: { name: 'New document' } });
    const { result, rerender } = renderHook(({ path }) => useResource(path, schema), {
      initialProps: { path: '/one' },
    });
    rerender({ path: '/two' });
    await waitFor(() => expect(result.current.result?.name).toBe('New document'));
    await act(async () => earlier.complete({ data: { name: 'Old document' } }));
    expect(result.current.result?.name).toBe('New document');
  });
  it('prevents duplicate writes while a submission is pending', async () => {
    const request = pending<{ data: { name: string } }>();
    host.post.mockReturnValue(request.promise);
    const completed = vi.fn();
    const { result } = renderHook(useMutation);
    act(() => {
      void result.current.run('post', '/example', {}, schema, completed);
      void result.current.run('post', '/example', {}, schema, completed);
    });
    expect(host.post).toHaveBeenCalledTimes(1);
    await act(async () => request.complete({ data: { name: 'Saved' } }));
    expect(completed).toHaveBeenCalledWith({ name: 'Saved' });
  });
  it('hides the document action without translate rights', () => {
    host.permissions.mockReturnValue({ allowedActions: {}, isLoading: false, permissions: [] });
    const { result } = renderHook(() => TranslateAction(context), { wrapper });
    expect(result.current).toBeNull();
    expect(host.get).not.toHaveBeenCalled();
  });
  it('hides the bulk action from a translate-only editor', () => {
    host.permissions.mockReturnValue({
      allowedActions: { canTranslate: true },
      isLoading: false,
      permissions: [],
    });
    const { result } = renderHook(
      () =>
        TranslateBulkAction({
          model: context.model,
          documents: [],
          collectionType: 'collection-types',
        }),
      { wrapper }
    );
    expect(result.current).toBeNull();
    expect(host.get).not.toHaveBeenCalled();
  });
  it('uses translation options without requiring settings access', async () => {
    const { result } = renderHook(() => TranslateAction(context), { wrapper });
    await waitFor(() => expect(result.current?.label).toBe('Translate'));
    expect(
      host.get.mock.calls.every(([path]) => path === '/general-translation/translation-options')
    ).toBe(true);
  });
  it('hides document actions before a document has been saved', async () => {
    const { result } = renderHook(() => TranslateAction({ ...context, documentId: undefined }), {
      wrapper,
    });
    await act(async () => {});
    expect(result.current).toBeNull();
  });
  it('keeps the panel hidden while role permission checks are pending', () => {
    host.permissions.mockReturnValue({
      allowedActions: { canTranslate: true },
      isLoading: true,
      permissions: [],
    });
    const { result } = renderHook(() => TranslationPanel(context), { wrapper });
    expect(result.current).toBeNull();
    expect(host.get).not.toHaveBeenCalled();
  });
  it('keeps the panel available for a visible connection failure and retry', async () => {
    host.get.mockRejectedValue(new Error('Offline'));
    const { result } = renderHook(() => TranslationPanel(context), { wrapper });
    await waitFor(() => expect(result.current?.title).toBe('Translation'));
  });
  it('requests one latest outcome per locale rather than a history page', async () => {
    host.get.mockResolvedValue({ data: { jobs: [], total: 0 } });
    renderAdmin(
      <DocumentPanel
        model="api::article.article"
        documentId="one"
        options={options}
        published={false}
      />
    );
    await waitFor(() => expect(host.get).toHaveBeenCalled());
    const query = new URL(host.get.mock.calls[0]?.[0], 'http://localhost');
    expect(query.pathname).toBe('/general-translation/jobs');
    expect(query.searchParams.get('latestPerLocale')).toBe('true');
    expect(query.searchParams.get('contentType')).toBe('api::article.article');
    expect(query.searchParams.get('documentId')).toBe('one');
  });
  it('groups document controls in a labelled accessibility region', async () => {
    host.get.mockResolvedValue({ data: { jobs: [], total: 0 } });
    renderAdmin(
      <DocumentPanel
        model="api::article.article"
        documentId="one"
        options={options}
        published={false}
      />
    );
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'General Translation controls' })).toBeTruthy()
    );
  });
  it('refuses incompatible Content Manager extension objects', () => {
    expect(isContentManagerApi({ addDocumentAction: vi.fn(), addBulkAction: vi.fn() })).toBe(false);
    expect(
      isContentManagerApi({
        addDocumentAction: vi.fn(),
        addBulkAction: vi.fn(),
        addEditViewSidePanel: vi.fn(),
      })
    ).toBe(true);
    expect(isContentManagerApi(null)).toBe(false);
  });
});
