import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { isMainThread, threadId } from 'node:worker_threads';
import { expect } from 'vitest';
import { summarizeJob } from '../../server/src/repository';
import type { StoredJob } from '../../server/src/validation';
import { formatUnknownError } from '../../shared/messages';

export const createFixtureEvidence = async (path: string, origins: string[]) => {
  const metadata = () => ({
    at: new Date().toISOString(),
    pid: process.pid,
    node: process.version,
    isMainThread,
    threadId,
    file: basename(expect.getState().testPath ?? 'fixture'),
    test: expect.getState().currentTestName,
  });
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ event: 'fixture-start', ...metadata() })}\n`, {
    mode: 0o600,
  });
  const pending: string[] = [];
  let writing = Promise.resolve();
  const flush = () => {
    const batch = pending.splice(0).join('');
    writing = writing.then(() => appendFile(path, batch));
    return writing;
  };
  const realFetch = globalThis.fetch;
  const capture: typeof fetch = async (...parameters) => {
    const input = parameters[0];
    const url = (() => {
      try {
        return new URL(input instanceof Request ? input.url : input);
      } catch {
        // Native fetch remains responsible for rejecting malformed request inputs.
        return undefined;
      }
    })();
    const observed = url && origins.includes(url.origin);
    const started = performance.now();
    const identity = metadata();
    try {
      const response = await realFetch(...parameters);
      if (observed)
        pending.push(
          `${JSON.stringify({ event: 'transport', ...identity, path: url.pathname, status: response.status, elapsedMs: performance.now() - started })}\n`
        );
      return response;
    } catch (failure) {
      const cause = failure instanceof Error ? failure.cause : undefined;
      if (observed)
        pending.push(
          `${JSON.stringify({ event: 'transport', ...identity, path: url.pathname, error: formatUnknownError(failure), cause: cause instanceof Error ? formatUnknownError(cause) : undefined, code: cause instanceof Error && 'code' in cause && typeof cause.code === 'string' ? formatUnknownError(cause.code) : undefined, elapsedMs: performance.now() - started })}\n`
        );
      throw failure;
    }
  };
  globalThis.fetch = capture;
  return {
    path,
    flush,
    job(event: string, job: StoredJob, committed?: boolean) {
      const summary = summarizeJob(job);
      pending.push(
        `${JSON.stringify({
          event,
          ...metadata(),
          job: {
            ...summary,
            error: summary.error
              ? {
                  ...summary.error,
                  text: formatUnknownError(summary.error.text),
                  details: Object.fromEntries(
                    Object.entries(summary.error.details).map(([key, value]) => [
                      key,
                      formatUnknownError(value),
                    ])
                  ),
                  docs: summary.error.docs ? formatUnknownError(summary.error.docs) : undefined,
                }
              : null,
          },
          committed,
          storedChunkCount: Object.keys(job.runtimeProgress ?? {}).length,
        })}\n`
      );
    },
    async close() {
      if (globalThis.fetch === capture) globalThis.fetch = realFetch;
      await flush();
    },
  };
};
