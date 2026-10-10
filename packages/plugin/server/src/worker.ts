import {
  JOB_LEASE_MS,
  RETRY_LIMIT,
  WORKER_CONCURRENCY,
  WORKER_POLL_MS,
} from '../../shared/constants';
import type { Diagnostic } from '../../shared/contracts';
import { formatUnknownError, messages } from '../../shared/messages';
import { transitionJob, type JobOperations } from './jobs';
import type { JobRepository } from './repository';
import { DiagnosticError, objectRecord, type StoredJob } from './validation';

interface WorkerDependencies {
  repository: Pick<JobRepository, 'claim' | 'renew' | 'completeStage'>;
  operations(job: StoredJob): Promise<JobOperations>;
  retryDelay(attempt: number): number;
  log(message: Diagnostic): void;
}
const safeDocumentation = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || formatUnknownError(value) !== value) return undefined;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password
      ? value
      : undefined;
  } catch {
    // A malformed provider link cannot become a documentation link in the admin.
    return undefined;
  }
};
export const classifyFailure = (
  failure: unknown
): {
  diagnostic: Diagnostic;
  retryable: boolean;
  retryAfterMs?: number;
  acceptance?: 'not-sent' | 'rejected' | 'unknown';
} => {
  if (failure instanceof DiagnosticError)
    return { diagnostic: failure.diagnostic, retryable: false };
  if (
    objectRecord(failure) &&
    objectRecord(failure.diagnostic) &&
    typeof failure.retryable === 'boolean'
  ) {
    const candidate = failure.diagnostic;
    if (
      typeof candidate.code === 'string' &&
      typeof candidate.text === 'string' &&
      objectRecord(candidate.details) &&
      Object.values(candidate.details).every((value) => typeof value === 'string')
    ) {
      const details: Record<string, string> = Object.fromEntries(
        Object.entries(candidate.details).flatMap(([key, value]) =>
          typeof value === 'string' && formatUnknownError(value) === value ? [[key, value]] : []
        )
      );
      const docs = safeDocumentation(candidate.docs);
      const diagnostic: Diagnostic = {
        code: candidate.code,
        text: candidate.text,
        details,
        level: candidate.level === 'warning' ? 'warning' : 'error',
        ...(docs ? { docs } : {}),
      };
      return {
        diagnostic,
        retryable: failure.retryable,
        ...(failure.acceptance === 'not-sent' ||
        failure.acceptance === 'rejected' ||
        failure.acceptance === 'unknown'
          ? { acceptance: failure.acceptance }
          : {}),
        ...(typeof failure.retryAfterMs === 'number' &&
        Number.isFinite(failure.retryAfterMs) &&
        failure.retryAfterMs >= 0
          ? { retryAfterMs: failure.retryAfterMs }
          : {}),
      };
    }
  }
  return {
    diagnostic: messages.providerFailure('The server could not complete the saved job'),
    retryable: false,
  };
};
export const runJobAttempt = async (
  job: StoredJob,
  dependencies: WorkerDependencies
): Promise<StoredJob> => {
  if (job.status !== 'running') return job;
  try {
    return await transitionJob(job, await dependencies.operations(job));
  } catch (failure) {
    const { diagnostic, retryable, retryAfterMs, acceptance } = classifyFailure(failure);
    const ambiguous =
      ['translate', 'enqueue'].includes(job.stage) &&
      (acceptance === 'unknown' || diagnostic.code === 'network-failure');
    const attempts = job.attempts + 1;
    const conflict = diagnostic.code === 'stale-source' || diagnostic.code === 'human-edit';
    return {
      ...job,
      attempts,
      error: ambiguous ? messages.interruptedRequest() : diagnostic,
      status: conflict
        ? 'conflict'
        : retryable && !ambiguous && attempts < RETRY_LIMIT
          ? 'waiting'
          : 'failed',
      nextRunAt: new Date(
        Date.now() + Math.max(dependencies.retryDelay(attempts), retryAfterMs ?? 0)
      ).toISOString(),
    };
  }
};
export const createWorker = (dependencies: WorkerDependencies) => {
  let stopping = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const running = new Set<Promise<void>>();
  const execute = async (): Promise<void> => {
    const job = await dependencies.repository.claim();
    if (!job) return;
    let owned = true;
    let renewing: Promise<void> | undefined;
    const heartbeat = setInterval(() => {
      if (renewing) return;
      renewing = dependencies.repository
        .renew(job)
        .then((result) => {
          owned = result;
        })
        .catch((failure) => {
          owned = false;
          dependencies.log(classifyFailure(failure).diagnostic);
        })
        .finally(() => {
          renewing = undefined;
        });
    }, JOB_LEASE_MS / WORKER_CONCURRENCY);
    try {
      const next = await runJobAttempt(job, dependencies);
      clearInterval(heartbeat);
      if (renewing) await renewing;
      if (owned && !(await dependencies.repository.completeStage(next)))
        dependencies.log(
          messages.validation('The worker lease expired; another worker will resume the job')
        );
    } finally {
      clearInterval(heartbeat);
    }
  };
  const tick = async (): Promise<void> => {
    if (stopping) return;
    while (running.size < WORKER_CONCURRENCY) {
      const task = execute().catch((failure) =>
        dependencies.log(classifyFailure(failure).diagnostic)
      );
      running.add(task);
      void task.finally(() => running.delete(task));
    }
    timer = setTimeout(() => {
      void tick();
    }, WORKER_POLL_MS);
  };
  return {
    start() {
      if (!stopping) return;
      stopping = false;
      void tick();
    },
    async stop() {
      stopping = true;
      if (timer) clearTimeout(timer);
      await Promise.all(running);
    },
    execute,
  };
};
