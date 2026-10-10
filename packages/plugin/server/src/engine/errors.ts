import type { Diagnostic } from '../../../shared/contracts';
import { messages } from '../../../shared/messages';

export class GtRequestError extends Error {
  readonly diagnostic: Diagnostic;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;

  constructor(diagnostic: Diagnostic, retryable = false, retryAfterMs?: number) {
    super(diagnostic.text);
    this.name = 'GtRequestError';
    this.diagnostic = diagnostic;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }
}

export const invalidTranslation = (reason: string): GtRequestError =>
  new GtRequestError(messages.validation(reason));
