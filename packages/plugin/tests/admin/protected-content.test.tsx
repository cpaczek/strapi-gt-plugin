// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { Notice } from '../../admin/src/components/Controls';
import { JobTable } from '../../admin/src/components/JobTable';
import { messages } from '../../shared/messages';
import { PLUGIN_ID } from '../../shared/constants';
import english from '../../admin/src/translations/en.json';
import spanish from '../../admin/src/translations/es.json';
import french from '../../admin/src/translations/fr.json';
import arabic from '../../admin/src/translations/ar.json';
import { failedJob } from './fixtures';
import { renderAdmin } from './render';

const locales = [
  { code: 'en', dictionary: english, happened: 'A target field is protected from replacement' },
  {
    code: 'es',
    dictionary: spanish,
    happened: 'Un campo de destino está protegido contra la sustitución',
  },
  { code: 'fr', dictionary: french, happened: 'Un champ cible est protégé contre le remplacement' },
  { code: 'ar', dictionary: arabic, happened: 'أحد الحقول المستهدفة محمي من الاستبدال' },
];
afterEach(cleanup);
describe('protected target guidance without assumed history', () => {
  it.each(locales)(
    'describes protection rather than a prior translation in $code',
    ({ code, dictionary, happened }) => {
      renderAdmin(
        <IntlProvider
          locale={code}
          messages={Object.fromEntries(
            Object.entries(dictionary).map(([key, value]) => [`${PLUGIN_ID}.${key}`, value])
          )}
        >
          <Notice diagnostic={messages.humanEdit()} />
        </IntlProvider>
      );
      expect(screen.getByText((text) => text.includes(happened))).toBeTruthy();
    }
  );
  it('uses the same accurate diagnostic for a protected job before its first GT request', () => {
    renderAdmin(
      <JobTable
        jobs={[{ ...failedJob, status: 'conflict', attempts: 0, error: messages.humanEdit() }]}
        busy={false}
        onRetry={() => {}}
      />
    );
    expect(screen.getByText(/A target field is protected from replacement/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Retry job/ })).toBeNull();
    expect(
      screen.getByText(/Review this document in Content Manager and start a new translation/)
    ).toBeTruthy();
  });
});
