import { DOCS_URL, ERROR_DETAIL_LIMIT, MESSAGE_PREFIX } from './constants';
import type { Diagnostic } from './contracts';
import english from '../admin/src/translations/en.json';

export interface MessageParts {
  code: string;
  happened: string;
  why?: string;
  fix?: string;
  fallback?: string;
  details?: Record<string, string>;
  docs?: string;
  docsLabel?: string;
  level?: Diagnostic['level'];
}

export const formatUnknownError = (failure: unknown): string => {
  const raw = (() => {
    if (typeof failure === 'string') return failure;
    if (typeof failure === 'object' && failure !== null) {
      try {
        const descriptor = Object.getOwnPropertyDescriptor(failure, 'message');
        if (descriptor && 'value' in descriptor && typeof descriptor.value === 'string') {
          return descriptor.value;
        }
      } catch {
        // Untrusted proxy traps cannot prevent an actionable error response.
        return 'The failure could not be inspected safely';
      }
    }
    return 'The service did not provide a safe error description';
  })();
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
  const docsLabel = parts.docsLabel?.trim() || english['diagnostic.documentation'];
  const text = `${MESSAGE_PREFIX} ${[...phrases, ...detailText].join(' ')}${parts.docs ? ` ${docsLabel}: ${parts.docs}` : ''}`;
  return {
    code: parts.code,
    level: parts.level ?? 'error',
    text,
    details,
    ...(parts.docs ? { docs: parts.docs } : {}),
  };
};

export type DiagnosticMessageKey = Extract<keyof typeof english, `diagnostic.${string}`>;
export type DiagnosticTranslator = (key: DiagnosticMessageKey) => string | undefined;

interface MessageDefinition {
  code: string;
  happened: DiagnosticMessageKey;
  why?: DiagnosticMessageKey;
  fix?: DiagnosticMessageKey;
  fallback?: DiagnosticMessageKey;
  level?: Diagnostic['level'];
}

const definitions = {
  invalidKey: {
    code: 'invalid-key',
    happened: 'diagnostic.invalid-key.happened',
    fix: 'diagnostic.invalid-key.fix',
    fallback: 'diagnostic.invalid-key.fallback',
  },
  missingKey: {
    code: 'missing-key',
    happened: 'diagnostic.missing-key.happened',
    fix: 'diagnostic.missing-key.fix',
  },
  quotaExhausted: {
    code: 'quota-exhausted',
    happened: 'diagnostic.quota-exhausted.happened',
    fix: 'diagnostic.quota-exhausted.fix',
    fallback: 'diagnostic.quota-exhausted.fallback',
  },
  permissionDenied: {
    code: 'permission-denied',
    happened: 'diagnostic.permission-denied.happened',
    fix: 'diagnostic.permission-denied.fix',
  },
  humanEdit: {
    code: 'human-edit',
    happened: 'diagnostic.human-edit.happened',
    fix: 'diagnostic.human-edit.fix',
    fallback: 'diagnostic.human-edit.fallback',
    level: 'warning',
  },
  staleSource: {
    code: 'stale-source',
    happened: 'diagnostic.stale-source.happened',
    fix: 'diagnostic.stale-source.fix',
    fallback: 'diagnostic.stale-source.fallback',
    level: 'warning',
  },
  aiConflict: {
    code: 'ai-conflict',
    happened: 'diagnostic.ai-conflict.happened',
    why: 'diagnostic.ai-conflict.why',
    fix: 'diagnostic.ai-conflict.fix',
    level: 'warning',
  },
  connectionSuccess: {
    code: 'connection-success',
    happened: 'diagnostic.connection-success.happened',
    level: 'success',
  },
  adminRequestFailure: {
    code: 'admin-request-failure',
    happened: 'diagnostic.admin-request-failure.happened',
    fix: 'diagnostic.admin-request-failure.fix',
    fallback: 'diagnostic.admin-request-failure.fallback',
  },
  adminIncompatible: {
    code: 'admin-incompatible',
    happened: 'diagnostic.admin-incompatible.happened',
    fix: 'diagnostic.admin-incompatible.fix',
  },
  forceRetranslate: {
    code: 'force-retranslate',
    happened: 'diagnostic.force-retranslate.happened',
    fix: 'diagnostic.force-retranslate.fix',
    fallback: 'diagnostic.force-retranslate.fallback',
    level: 'warning',
  },
  settingsSaved: {
    code: 'settings-saved',
    happened: 'diagnostic.settings-saved.happened',
    level: 'success',
  },
  mediaSaved: {
    code: 'media-saved',
    happened: 'diagnostic.media-saved.happened',
    level: 'success',
  },
  interruptedRequest: {
    code: 'interrupted-request',
    happened: 'diagnostic.interrupted-request.happened',
    why: 'diagnostic.interrupted-request.why',
    fix: 'diagnostic.interrupted-request.fix',
    fallback: 'diagnostic.interrupted-request.fallback',
  },
  mediaUnavailable: {
    code: 'media-unavailable',
    happened: 'diagnostic.media-unavailable.happened',
    fix: 'diagnostic.media-unavailable.fix',
    fallback: 'diagnostic.media-unavailable.fallback',
    level: 'warning',
  },
  jobsQueued: {
    code: 'jobs-queued',
    happened: 'diagnostic.jobs-queued.happened',
    level: 'success',
  },
  unsupportedLocale: {
    code: 'unsupported-locale',
    happened: 'diagnostic.unsupported-locale.happened',
    fix: 'diagnostic.unsupported-locale.fix',
  },
  networkFailure: {
    code: 'network-failure',
    happened: 'diagnostic.network-failure.happened',
    fix: 'diagnostic.network-failure.fix',
  },
  validation: {
    code: 'validation',
    happened: 'diagnostic.validation.happened',
    fix: 'diagnostic.validation.fix',
  },
  providerFailure: {
    code: 'provider-failure',
    happened: 'diagnostic.provider-failure.happened',
    fix: 'diagnostic.provider-failure.fix',
  },
  missingLocale: {
    code: 'missing-locale',
    happened: 'diagnostic.missing-locale.happened',
    fix: 'diagnostic.missing-locale.fix',
  },
  sourceLocaleMismatch: {
    code: 'source-locale-mismatch',
    happened: 'diagnostic.source-locale-mismatch.happened',
    fix: 'diagnostic.source-locale-mismatch.fix',
  },
} satisfies Record<string, MessageDefinition>;

const phrase = (
  key: DiagnosticMessageKey | undefined,
  translate?: DiagnosticTranslator
): string | undefined => {
  if (!key) return undefined;
  const translated = translate?.(key);
  return translated?.trim() && translated !== key ? translated : english[key];
};

const definitionParts = (
  definition: MessageDefinition,
  translate?: DiagnosticTranslator
): MessageParts => {
  return {
    code: definition.code,
    happened: phrase(definition.happened, translate) ?? english[definition.happened],
    why: phrase(definition.why, translate),
    fix: phrase(definition.fix, translate),
    fallback: phrase(definition.fallback, translate),
    level: definition.level,
  };
};

export const localizeDiagnostic = (
  diagnostic: Diagnostic,
  translate: DiagnosticTranslator
): Diagnostic => {
  // Transport codes are untrusted; matching values avoids inherited object keys.
  const definition = Object.values(definitions).find((entry) => entry.code === diagnostic.code);
  if (!definition) return diagnostic;
  return buildMessage({
    ...definitionParts(definition, translate),
    code: diagnostic.code,
    level: diagnostic.level,
    details: diagnostic.details,
    docs: diagnostic.docs,
    docsLabel: diagnostic.docs ? phrase('diagnostic.documentation', translate) : undefined,
  });
};

export const messages = {
  invalidKey: () => buildMessage({ ...definitionParts(definitions.invalidKey), docs: DOCS_URL }),
  missingKey: () => buildMessage({ ...definitionParts(definitions.missingKey), docs: DOCS_URL }),
  quotaExhausted: () =>
    buildMessage({ ...definitionParts(definitions.quotaExhausted), docs: DOCS_URL }),
  permissionDenied: () => buildMessage(definitionParts(definitions.permissionDenied)),
  humanEdit: () => buildMessage(definitionParts(definitions.humanEdit)),
  staleSource: () => buildMessage(definitionParts(definitions.staleSource)),
  aiConflict: () => buildMessage(definitionParts(definitions.aiConflict)),
  connectionSuccess: () => buildMessage(definitionParts(definitions.connectionSuccess)),
  adminRequestFailure: () => buildMessage(definitionParts(definitions.adminRequestFailure)),
  adminIncompatible: () => buildMessage(definitionParts(definitions.adminIncompatible)),
  forceRetranslate: () => buildMessage(definitionParts(definitions.forceRetranslate)),
  settingsSaved: () => buildMessage(definitionParts(definitions.settingsSaved)),
  mediaSaved: () => buildMessage(definitionParts(definitions.mediaSaved)),
  interruptedRequest: () => buildMessage(definitionParts(definitions.interruptedRequest)),
  mediaUnavailable: () => buildMessage(definitionParts(definitions.mediaUnavailable)),
  jobsQueued: (count: number) =>
    buildMessage({
      ...definitionParts(definitions.jobsQueued),
      details: { count: String(count) },
    }),
  unsupportedLocale: (locale: string) =>
    buildMessage({
      ...definitionParts(definitions.unsupportedLocale),
      details: { locale },
      docs: DOCS_URL,
    }),
  networkFailure: (failure: unknown) =>
    buildMessage({
      ...definitionParts(definitions.networkFailure),
      details: { reason: formatUnknownError(failure) },
    }),
  validation: (reason: string) =>
    buildMessage({
      ...definitionParts(definitions.validation),
      details: { reason },
    }),
  providerFailure: (failure: unknown) =>
    buildMessage({
      ...definitionParts(definitions.providerFailure),
      details: { reason: formatUnknownError(failure) },
      docs: DOCS_URL,
    }),
  missingLocale: (locale: string) =>
    buildMessage({
      ...definitionParts(definitions.missingLocale),
      details: { locale },
    }),
  sourceLocaleMismatch: (locale: string) =>
    buildMessage({
      ...definitionParts(definitions.sourceLocaleMismatch),
      details: { locale },
    }),
};
