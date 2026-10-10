import { DOCS_URL, ERROR_DETAIL_LIMIT, MESSAGE_PREFIX } from './constants';
import type { Diagnostic } from './contracts';

export interface MessageParts {
  code: string;
  happened: string;
  why?: string;
  fix?: string;
  fallback?: string;
  details?: Record<string, string>;
  docs?: string;
  level?: Diagnostic['level'];
}

export const formatUnknownError = (failure: unknown): string => {
  const descriptor =
    typeof failure === 'object' && failure !== null
      ? Object.getOwnPropertyDescriptor(failure, 'message')
      : undefined;
  const raw =
    typeof failure === 'string'
      ? failure
      : descriptor && 'value' in descriptor && typeof descriptor.value === 'string'
        ? descriptor.value
        : 'The service did not provide a safe error description';
  return (
    raw
      .replace(/gtx-[\w-]+/gi, '[redacted]')
      .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
      .replace(
        /((?:api[_-]?key|token|password|secret|authorization)\s*[=:]\s*)[^\s&,;]+/gi,
        '$1[redacted]'
      )
      .replace(/(https?:\/\/)[^/\s@]+@/gi, '$1[redacted]@')
      // Provider diagnostics must not carry terminal control characters.
      // oxlint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .slice(0, ERROR_DETAIL_LIMIT)
  );
};

const sentence = (phrase: string): string => {
  const trimmed = phrase.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
};

export const buildMessage = (parts: MessageParts): Diagnostic => {
  if (!parts.happened.trim()) throw new TypeError('A diagnostic must describe the failed action.');
  const phrases = [parts.happened, parts.why, parts.fix, parts.fallback]
    .filter((phrase): phrase is string => typeof phrase === 'string' && phrase.trim().length > 0)
    .map(sentence);
  const details = Object.fromEntries(
    Object.entries(parts.details ?? {}).map(([key, value]) => [key, formatUnknownError(value)])
  );
  const detailText = Object.values(details).map(sentence);
  const text = `${MESSAGE_PREFIX} ${[...phrases, ...detailText].join(' ')}${parts.docs ? ` Documentation: ${parts.docs}` : ''}`;
  return {
    code: parts.code,
    level: parts.level ?? 'error',
    text,
    details,
    ...(parts.docs ? { docs: parts.docs } : {}),
  };
};

const definitions = {
  invalidKey: {
    code: 'invalid-key',
    happened: 'GT rejected the API key',
    fix: 'Set a valid GT_API_KEY on the Strapi server and restart it',
    fallback: 'Continue editing while an administrator updates the key',
  },
  missingKey: {
    code: 'missing-key',
    happened: 'The GT connection is not configured',
    fix: 'Set GT_API_KEY on the Strapi server and restart it',
  },
  quotaExhausted: {
    code: 'quota-exhausted',
    happened: 'GT paused translation because the account has no available credit',
    fix: 'Review billing and spending limits in your GT account',
    fallback: 'Keep the existing translations until credit is available',
  },
  permissionDenied: {
    code: 'permission-denied',
    happened: 'You do not have permission to translate this content',
    fix: 'Ask an administrator for the required content and locale permissions',
  },
  humanEdit: {
    code: 'human-edit',
    happened: 'A target field was edited after translation',
    fix: 'Review the target content before choosing force retranslate',
    fallback: 'Keep the human edit',
    level: 'warning',
  },
  staleSource: {
    code: 'stale-source',
    happened: 'The source changed while translation was running',
    fix: 'Translate the latest saved source',
    fallback: 'The target content has been kept',
    level: 'warning',
  },
  aiConflict: {
    code: 'ai-conflict',
    happened: 'Strapi AI Translations is also enabled',
    why: 'Both translation systems can update the same locales',
    fix: 'Choose one automatic translator for these content types',
    level: 'warning',
  },
  connectionSuccess: {
    code: 'connection-success',
    happened: 'Connected to your GT project',
    level: 'success',
  },
} satisfies Record<string, MessageParts>;

export const messages = {
  invalidKey: () => buildMessage({ ...definitions.invalidKey, docs: DOCS_URL }),
  missingKey: () => buildMessage({ ...definitions.missingKey, docs: DOCS_URL }),
  quotaExhausted: () => buildMessage({ ...definitions.quotaExhausted, docs: DOCS_URL }),
  permissionDenied: () => buildMessage(definitions.permissionDenied),
  humanEdit: () => buildMessage(definitions.humanEdit),
  staleSource: () => buildMessage(definitions.staleSource),
  aiConflict: () => buildMessage(definitions.aiConflict),
  connectionSuccess: () => buildMessage(definitions.connectionSuccess),
  unsupportedLocale: (locale: string) =>
    buildMessage({
      code: 'unsupported-locale',
      happened: 'The locale is not supported by GT',
      fix: 'Select a supported locale or add an explicit locale mapping',
      details: { locale },
      docs: DOCS_URL,
    }),
  networkFailure: (failure: unknown) =>
    buildMessage({
      code: 'network-failure',
      happened: 'The GT request could not finish',
      fix: 'Check the server network connection and retry the job',
      details: { reason: formatUnknownError(failure) },
    }),
  validation: (reason: string) =>
    buildMessage({
      code: 'validation',
      happened: 'The translation request is not valid',
      fix: 'Correct the highlighted settings and try again',
      details: { reason },
    }),
  providerFailure: (failure: unknown) =>
    buildMessage({
      code: 'provider-failure',
      happened: 'GT could not translate the content',
      fix: 'Review the job details and retry after correcting the cause',
      details: { reason: formatUnknownError(failure) },
      docs: DOCS_URL,
    }),
  missingLocale: (locale: string) =>
    buildMessage({
      code: 'missing-locale',
      happened: 'The target locale does not exist for this document',
      fix: 'Enable creation of missing locales and confirm your create permission',
      details: { locale },
    }),
  sourceLocaleMismatch: (locale: string) =>
    buildMessage({
      code: 'source-locale-mismatch',
      happened: 'The GT project uses a different source locale',
      fix: 'Select the matching GT project before uploading translation files',
      details: { locale },
    }),
};
