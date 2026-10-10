import type { Diagnostic } from '../../../shared/contracts';
import { messages } from '../../../shared/messages';

export class GtRequestError extends Error {
  readonly diagnostic: Diagnostic;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  readonly acceptance: 'not-sent' | 'rejected' | 'unknown';
  readonly httpStatus?: number;

  constructor(
    diagnostic: Diagnostic,
    retryable = false,
    retryAfterMs?: number,
    outcome: { acceptance?: 'not-sent' | 'rejected' | 'unknown'; httpStatus?: number } = {}
  ) {
    super(diagnostic.text);
    this.name = 'GtRequestError';
    this.diagnostic = diagnostic;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
    this.acceptance = outcome.acceptance ?? 'not-sent';
    this.httpStatus = outcome.httpStatus;
  }
}

export const invalidTranslation = (reason: string): GtRequestError =>
  new GtRequestError(messages.validation(reason));
