import { getSupportedLocale } from '@generaltranslation/supported-locales';
import { RETRY_BASE_MS, RETRY_MAX_MS } from '../../../shared/constants';
import { messages } from '../../../shared/messages';
import { GtRequestError, invalidTranslation } from './errors';

export const resolveGtLocale = (locale: string, mapping: Record<string, string>): string => {
  const mapped = Object.hasOwn(mapping, locale) ? mapping[locale] : locale;
  const supported = mapped ? getSupportedLocale(mapped) : null;
  if (!supported || supported === 'qbr')
    throw new GtRequestError(messages.unsupportedLocale(locale));
  return supported;
};

export const retryDelay = (attempt: number, random: () => number = Math.random): number => {
  const jitter = random();
  if (
    !Number.isInteger(attempt) ||
    attempt < 0 ||
    !Number.isFinite(jitter) ||
    jitter < 0 ||
    jitter > 1
  ) {
    throw invalidTranslation('Retry attempt and jitter must be within their allowed ranges');
  }
  const ceiling = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** attempt);
  return Math.floor((ceiling * (1 + jitter)) / 2);
};
