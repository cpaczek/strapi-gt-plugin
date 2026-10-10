// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import type { ReactNode } from 'react';
import { JobTable } from '../../admin/src/components/JobTable';
import { MediaEditor } from '../../admin/src/components/MediaEditor';
import { Notice } from '../../admin/src/components/Controls';
import { messages } from '../../shared/messages';
import { PLUGIN_ID } from '../../shared/constants';
import english from '../../admin/src/translations/en.json';
import spanish from '../../admin/src/translations/es.json';
import french from '../../admin/src/translations/fr.json';
import arabic from '../../admin/src/translations/ar.json';
import { failedJob } from './fixtures';
import { renderAdmin } from './render';

const dictionaries = { en: english, es: spanish, fr: french, ar: arabic };
const renderLocale = (locale: keyof typeof dictionaries, children: ReactNode) =>
  renderAdmin(
    <IntlProvider
      locale={locale}
      messages={Object.fromEntries(
        Object.entries(dictionaries[locale]).map(([key, value]) => [`${PLUGIN_ID}.${key}`, value])
      )}
    >
      {children}
    </IntlProvider>
  );
const metadata = (
  <MediaEditor
    response={{
      draftAndPublish: true,
      items: [
        {
          path: ['cover'],
          assetId: '7',
          property: 'alternativeText',
          source: 'Source alt',
          value: 'Target alt',
          status: 'translated',
        },
        {
          path: ['cover'],
          assetId: '7',
          property: 'caption',
          source: 'Source caption',
          value: 'Target caption',
          status: 'translated',
        },
      ],
    }}
    model="api::article.article"
    documentId="one"
    locale="fr"
    readOnly={false}
    busy={false}
    onSave={vi.fn()}
  />
);
afterEach(cleanup);

describe('review recovery and composed labels', () => {
  it('explains how to start a new request instead of offering an invalid conflict retry', () => {
    const retry = vi.fn();
    renderAdmin(
      <JobTable
        jobs={[{ ...failedJob, status: 'conflict', error: messages.staleSource() }]}
        busy={false}
        onRetry={retry}
      />
    );
    expect(screen.queryByRole('button', { name: 'Retry job 1' })).toBeNull();
    expect(
      screen.getByText(/Review this document in Content Manager and start a new translation/)
    ).toBeTruthy();
    expect(retry).not.toHaveBeenCalled();
  });
  it('does not offer translation recovery without translation rights', () => {
    renderAdmin(<JobTable jobs={[{ ...failedJob, status: 'conflict' }]} busy={false} />);
    expect(
      screen.queryByText(/Review this document in Content Manager and start a new translation/)
    ).toBeNull();
    expect(screen.queryByRole('button', { name: /Retry/ })).toBeNull();
  });
  it('retains failed-job retry as a separate recovery path', () => {
    renderAdmin(<JobTable jobs={[failedJob]} busy={false} onRetry={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Retry job 1' })).toBeTruthy();
    expect(
      screen.queryByText(/Review this document in Content Manager and start a new translation/)
    ).toBeNull();
  });
  it.each(['Valeur localisée (texte alternatif) : cover', 'Valeur localisée (légende) : cover'])(
    'renders the French metadata label %s',
    (label) => {
      renderLocale('fr', metadata);
      expect(screen.getByRole('textbox', { name: label })).toBeTruthy();
    }
  );
  it.each(['القيمة الموطّنة لـ نص بديل: cover', 'القيمة الموطّنة لـ تعليق توضيحي: cover'])(
    'renders the Arabic metadata label %s',
    (label) => {
      renderLocale('ar', metadata);
      expect(screen.getByRole('textbox', { name: label })).toBeTruthy();
    }
  );
  it.each([
    'القيمة الأصلية لـ نص بديل: Source alt',
    'القيمة الأصلية لـ تعليق توضيحي: Source caption',
  ])('renders the Arabic source label %s', (label) => {
    renderLocale('ar', metadata);
    expect(screen.getByText(label)).toBeTruthy();
  });
  it('uses feminine plural agreement in the French force warning', () => {
    renderLocale('fr', <Notice diagnostic={messages.forceRetranslate()} />);
    expect(screen.getByText(/dans les langues sélectionnées/)).toBeTruthy();
    expect(screen.queryByText(/langues sélectionnés/)).toBeNull();
  });
  it.each([
    {
      locale: 'en',
      guidance: 'Review the request details, correct the settings or content, and try again',
    },
    {
      locale: 'es',
      guidance:
        'Revisa los detalles de la solicitud, corrige la configuración o el contenido e inténtalo de nuevo',
    },
    {
      locale: 'fr',
      guidance:
        'Consultez les détails de la demande, corrigez les paramètres ou le contenu, puis réessayez',
    },
    { locale: 'ar', guidance: 'راجع تفاصيل الطلب، وصحّح الإعدادات أو المحتوى، ثم حاول مرة أخرى' },
  ] as const)('gives accurate validation guidance in $locale', ({ locale, guidance }) => {
    renderLocale(
      locale,
      <Notice diagnostic={messages.validation('Project ID exceeds 200 characters')} />
    );
    expect(
      screen.getByText(
        (text) => text.includes(guidance) && text.includes('Project ID exceeds 200 characters')
      )
    ).toBeTruthy();
  });
});
