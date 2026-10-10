import { createIntl, createIntlCache } from 'react-intl';
import { describe, expect, it, vi } from 'vitest';
import * as diagnostics from '../../shared/messages';
import { descriptor } from '../../admin/src/i18n';
import type { Diagnostic } from '../../shared/contracts';

const { messages } = diagnostics;
const samples = [
  messages.invalidKey(),
  messages.missingKey(),
  messages.quotaExhausted(),
  messages.permissionDenied(),
  messages.humanEdit(),
  messages.staleSource(),
  messages.aiConflict(),
  messages.connectionSuccess(),
  messages.adminRequestFailure(),
  messages.adminIncompatible(),
  messages.forceRetranslate(),
  messages.settingsSaved(),
  messages.mediaSaved(),
  messages.interruptedRequest(),
  messages.mediaUnavailable(),
  messages.jobsQueued(3),
  messages.unsupportedLocale('xx-ZZ'),
  messages.networkFailure(new Error('Connection refused')),
  messages.validation('Select a content type'),
  messages.providerFailure(new Error('Translation rejected')),
  messages.missingLocale('fr-CA'),
  messages.sourceLocaleMismatch('en-US'),
];

describe('canonical diagnostic wording', () => {
  it('keeps every existing English diagnostic byte-for-byte stable', () => {
    expect(samples).toMatchSnapshot();
  });
});

const french = createIntl(
  {
    locale: 'fr',
    messages: {
      'general-translation.diagnostic.ai-conflict.happened':
        'La traduction IA de Strapi est aussi activée',
      'general-translation.diagnostic.ai-conflict.why':
        'Les deux systèmes peuvent modifier les mêmes langues',
      'general-translation.diagnostic.ai-conflict.fix': 'Choisissez un seul traducteur automatique',
      'general-translation.diagnostic.interrupted-request.happened': 'La demande a été interrompue',
      'general-translation.diagnostic.interrupted-request.why':
        'GT a peut-être déjà facturé cette demande',
      'general-translation.diagnostic.interrupted-request.fix':
        'Vérifiez la tâche avant de réessayer',
      'general-translation.diagnostic.interrupted-request.fallback': 'Conservez le contenu actuel',
    },
    onError: (failure) => {
      throw failure;
    },
  },
  createIntlCache()
);

describe('localized diagnostics', () => {
  it('localizes the documentation label without translating its URL', () => {
    const source = messages.invalidKey();
    const result = diagnostics.localizeDiagnostic(source, (key) =>
      String(key) === 'diagnostic.documentation' ? 'Documentación' : undefined
    );
    expect(result.text).toContain(`Documentación: ${source.docs}`);
    expect(result.docs).toBe(source.docs);
  });
  it('formats known static clauses with a French formatter', () => {
    expect(
      diagnostics.localizeDiagnostic(messages.aiConflict(), (key) =>
        french.formatMessage(descriptor(key))
      )
    ).toEqual({
      code: 'ai-conflict',
      level: 'warning',
      details: {},
      text: 'General Translation: La traduction IA de Strapi est aussi activée. Les deux systèmes peuvent modifier les mêmes langues. Choisissez un seul traducteur automatique.',
    });
  });
  it('includes all four clauses in order without duplicating the prefix', () => {
    const result = diagnostics.localizeDiagnostic(messages.interruptedRequest(), (key) =>
      french.formatMessage(descriptor(key))
    );
    expect(result.text).toBe(
      'General Translation: La demande a été interrompue. GT a peut-être déjà facturé cette demande. Vérifiez la tâche avant de réessayer. Conservez le contenu actuel.'
    );
    expect(result.text.match(/General Translation:/g)).toHaveLength(1);
  });
  it('round trips every source message through English translation resources', () => {
    const english = createIntl({ locale: 'en' }, createIntlCache());
    for (const sample of samples)
      expect(
        diagnostics.localizeDiagnostic(sample, (key) => english.formatMessage(descriptor(key)))
      ).toEqual(sample);
  });
  it.each([
    '',
    'future-code',
    '__proto__',
    'constructor',
    'toString',
    'diagnostic.ai-conflict.happened',
  ])('preserves unknown code %s without looking it up', (code) => {
    const source: Diagnostic = {
      code,
      level: 'warning',
      text: 'Safe server wording',
      details: { locale: 'fr' },
      docs: 'https://example.com/help',
    };
    const translate = vi.fn(() => {
      throw new Error('Unknown diagnostic reached formatter');
    });
    expect(diagnostics.localizeDiagnostic(source, translate)).toBe(source);
    expect(translate).not.toHaveBeenCalled();
  });
  it.each([undefined, '', '  '])(
    'uses canonical English for a missing translation %s',
    (missing) => {
      expect(diagnostics.localizeDiagnostic(messages.invalidKey(), () => missing)).toEqual(
        messages.invalidKey()
      );
    }
  );
  it('uses canonical English if a formatter returns an unresolved key', () => {
    expect(diagnostics.localizeDiagnostic(messages.invalidKey(), (key) => key)).toEqual(
      messages.invalidKey()
    );
  });
  it('preserves variable details and links without sending them to the formatter', () => {
    const source: Diagnostic = {
      ...messages.unsupportedLocale('العربية {count} <b>locale</b>'),
      level: 'success',
      docs: 'https://example.com/help?locale=ar',
    };
    const translate = vi.fn(() => 'Choisissez une langue');
    const result = diagnostics.localizeDiagnostic(source, translate);
    expect(result.details).toEqual(source.details);
    expect(result.docs).toBe(source.docs);
    expect(result.level).toBe(source.level);
    expect(result.text).toContain(
      'العربية {count} <b>locale</b>. Documentation: https://example.com/help?locale=ar'
    );
    expect(translate.mock.calls).toEqual([
      ['diagnostic.unsupported-locale.happened'],
      ['diagnostic.unsupported-locale.fix'],
    ]);
  });
  it('preserves a deliberately absent documentation link', () => {
    const { docs: _docs, ...source } = messages.invalidKey();
    expect(diagnostics.localizeDiagnostic(source, () => undefined).docs).toBeUndefined();
  });
  it.each(['error', 'warning', 'success'] satisfies Diagnostic['level'][])(
    'preserves the server level %s',
    (level) => {
      const source = { ...messages.settingsSaved(), level };
      expect(diagnostics.localizeDiagnostic(source, () => 'Enregistré').level).toBe(level);
    }
  );
  it('never substitutes detail values into a translation template', () => {
    const result = diagnostics.localizeDiagnostic(
      messages.jobsQueued(3),
      () => 'Demandes ajoutées'
    );
    expect(result.text).toBe('General Translation: Demandes ajoutées. 3.');
    expect(result.details).toEqual({ count: '3' });
  });
  it('keeps already sanitized details intact', () => {
    const source = messages.providerFailure(new Error('token=example-private gtx-example-private'));
    const result = diagnostics.localizeDiagnostic(source, () => 'Échec');
    expect(result.details).toEqual(source.details);
    expect(result.text).not.toContain('example-private');
  });
  it('does not mutate a frozen transport object', () => {
    const source = Object.freeze({
      ...messages.validation('Invalid field'),
      details: Object.freeze({ reason: 'Invalid field' }),
    });
    expect(() => diagnostics.localizeDiagnostic(source, () => 'Corrigez le champ')).not.toThrow();
    expect(source).toEqual(messages.validation('Invalid field'));
  });
  it('preserves translated punctuation and non-Latin text', () => {
    expect(diagnostics.localizeDiagnostic(messages.settingsSaved(), () => 'تم الحفظ!').text).toBe(
      'General Translation: تم الحفظ!'
    );
  });
  it('does not reuse stale English text when details are empty', () => {
    const source = { ...messages.validation('Old reason'), details: {} };
    const result = diagnostics.localizeDiagnostic(source, () => 'Vérifiez les paramètres');
    expect(result.text).not.toContain('Old reason');
  });
});
