// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { Notice } from '../../admin/src/components/Controls';
import { JobTable } from '../../admin/src/components/JobTable';
import { messages } from '../../shared/messages';
import { renderAdmin } from './render';
import { failedJob } from './fixtures';

const french = {
  'general-translation.diagnostic.settings-saved.happened': 'Les paramètres ont été enregistrés',
  'general-translation.diagnostic.validation.happened': 'La demande est incorrecte',
  'general-translation.diagnostic.validation.fix': 'Corrigez les paramètres',
  'general-translation.diagnostic.permission-denied.happened':
    'Vous ne pouvez pas traduire ce contenu',
  'general-translation.diagnostic.permission-denied.fix': 'Demandez les autorisations nécessaires',
};

afterEach(cleanup);
describe('translated diagnostic surfaces', () => {
  it('shows known notification text in the selected admin language', () => {
    renderAdmin(
      <IntlProvider locale="fr" messages={french}>
        <Notice diagnostic={messages.settingsSaved()} />
      </IntlProvider>
    );
    expect(screen.getByRole('status').textContent).toContain(
      'General Translation: Les paramètres ont été enregistrés.'
    );
    expect(screen.queryByText(messages.settingsSaved().text)).toBeNull();
  });
  it('shows failed job details in the selected admin language', () => {
    renderAdmin(
      <IntlProvider locale="fr" messages={french}>
        <JobTable jobs={[{ ...failedJob, error: messages.permissionDenied() }]} busy={false} />
      </IntlProvider>
    );
    expect(
      screen.getByText(
        'General Translation: Vous ne pouvez pas traduire ce contenu. Demandez les autorisations nécessaires.'
      )
    ).toBeTruthy();
    expect(screen.queryByText(messages.permissionDenied().text)).toBeNull();
  });
  it('keeps structured details as escaped text in a translated notice', () => {
    renderAdmin(
      <IntlProvider locale="fr" messages={french}>
        <Notice diagnostic={messages.validation('<img src=x onerror=alert(1)>')} />
      </IntlProvider>
    );
    expect(screen.getByRole('alert').textContent).toContain(
      'La demande est incorrecte. Corrigez les paramètres. <img src=x onerror=alert(1)>.'
    );
    expect(screen.queryByRole('img')).toBeNull();
  });
  it('keeps the server fallback for an unknown notice and job code', () => {
    const diagnostic = {
      ...messages.settingsSaved(),
      code: '__proto__',
      text: 'Safe future message',
    };
    renderAdmin(
      <IntlProvider locale="fr" messages={french}>
        <Notice diagnostic={diagnostic} />
        <JobTable jobs={[{ ...failedJob, error: diagnostic }]} busy={false} />
      </IntlProvider>
    );
    expect(screen.getAllByText('Safe future message')).toHaveLength(2);
  });
});
