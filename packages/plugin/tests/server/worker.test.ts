import { afterEach, describe, expect, it, vi } from 'vitest';
import { JOB_LEASE_MS, WORKER_CONCURRENCY, WORKER_POLL_MS } from '../../shared/constants';
import type { GtClient, PreparedTranslation } from '../../shared/contracts';
import { createWorker, classifyFailure } from '../../server/src/worker';
import { jobFixture } from './persistence-fixture';

const prepared: PreparedTranslation = {
  input: {
    schema: { uid: 'api::article.article', localized: true, draftAndPublish: true, attributes: {} },
    components: {},
    source: {},
    target: null,
    rules: {},
    checkpoints: {},
    force: false,
    mediaMetadata: false,
  },
  sourceHash: 's',
  targetHash: 't',
  segments: [],
  protectedPaths: [],
  unchangedPaths: [],
};
const client: GtClient = {
  testConnection: async () => ({ id: 'p', name: 'P', sourceLocale: 'en', locales: ['fr'] }),
  translate: async () => ({}),
  upload: async () => ({ fileId: 'f', versionId: 'v', branchId: 'b' }),
  enqueue: async () => [],
  poll: async () => ({ status: 'ready' }),
  download: async () => ({}),
};
const setup = () => {
  const job = jobFixture({
    id: 1,
    status: 'running',
    stage: 'apply',
    prepared,
    leaseOwner: 'owner',
  });
  const repository = {
    claim: vi.fn(async () => job),
    renew: vi.fn(async () => true),
    completeStage: vi.fn(async () => true),
  };
  const log = vi.fn();
  const apply = vi.fn(async () => undefined);
  const operations = vi.fn(async () => ({ client, prepare: async () => prepared, apply }));
  const worker = createWorker({
    repository,
    operations,
    retryDelay: () => WORKER_POLL_MS,
    log,
  });
  return { worker, repository, log, apply, operations };
};
afterEach(() => vi.useRealTimers());
describe('worker lifecycle', () => {
  it('persists success only after content application', async () => {
    const { worker, repository, apply } = setup();
    await worker.execute();
    expect(apply).toHaveBeenCalledOnce();
    expect(repository.completeStage).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'succeeded' })
    );
  });
  it('does nothing when no job is due', async () => {
    const { worker, repository, apply } = setup();
    repository.claim.mockResolvedValueOnce(null);
    await worker.execute();
    expect(apply).not.toHaveBeenCalled();
    expect(repository.completeStage).not.toHaveBeenCalled();
  });
  it('renews an in-flight lease', async () => {
    vi.useFakeTimers();
    const { worker, repository, apply } = setup();
    let finish: () => void = () => undefined;
    apply.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve(undefined);
        })
    );
    const execution = worker.execute();
    await vi.advanceTimersByTimeAsync(JOB_LEASE_MS / WORKER_CONCURRENCY);
    expect(repository.renew).toHaveBeenCalledOnce();
    finish();
    await execution;
  });
  it('cannot commit after losing its lease', async () => {
    vi.useFakeTimers();
    const { worker, repository, apply } = setup();
    let finish: () => void = () => undefined;
    apply.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve(undefined);
        })
    );
    repository.renew.mockResolvedValue(false);
    const execution = worker.execute();
    await vi.advanceTimersByTimeAsync(JOB_LEASE_MS / WORKER_CONCURRENCY);
    finish();
    await execution;
    expect(repository.completeStage).not.toHaveBeenCalled();
  });
  it('reports renewal failures without exposing raw exceptions', async () => {
    vi.useFakeTimers();
    const { worker, repository, apply, log } = setup();
    let finish: () => void = () => undefined;
    apply.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve(undefined);
        })
    );
    repository.renew.mockRejectedValue(new Error('private-key'));
    const execution = worker.execute();
    await vi.advanceTimersByTimeAsync(JOB_LEASE_MS / WORKER_CONCURRENCY);
    finish();
    await execution;
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-key');
    expect(repository.completeStage).not.toHaveBeenCalled();
  });
  it('logs a rejected stale completion', async () => {
    const { worker, repository, log } = setup();
    repository.completeStage.mockResolvedValue(false);
    await worker.execute();
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ code: 'validation' }));
  });
  it('starts a bounded poll loop and stops further claims', async () => {
    vi.useFakeTimers();
    const { worker, repository } = setup();
    repository.claim.mockResolvedValue(null);
    worker.start();
    worker.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(repository.claim).toHaveBeenCalledTimes(WORKER_CONCURRENCY);
    await worker.stop();
    await vi.advanceTimersByTimeAsync(WORKER_POLL_MS);
    expect(repository.claim).toHaveBeenCalledTimes(WORKER_CONCURRENCY);
  });
  it('records an acquisition failure and keeps the loop available', async () => {
    vi.useFakeTimers();
    const { worker, repository, log } = setup();
    repository.claim.mockRejectedValue(new Error('database unavailable'));
    worker.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toHaveBeenCalledTimes(WORKER_CONCURRENCY);
    await worker.stop();
  });
  it('waits for active work during shutdown', async () => {
    vi.useFakeTimers();
    const { worker, repository, apply } = setup();
    const job = jobFixture({
      id: 1,
      status: 'running',
      stage: 'apply',
      prepared,
      leaseOwner: 'owner',
    });
    repository.claim.mockResolvedValue(null).mockResolvedValueOnce(job);
    let finish: () => void = () => undefined;
    apply.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve(undefined);
        })
    );
    worker.start();
    await vi.advanceTimersByTimeAsync(0);
    let stopped = false;
    const stop = worker.stop().then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);
    finish();
    await stop;
    expect(stopped).toBe(true);
  });
  it('classifies malformed provider diagnostics as a generic failure', () =>
    expect(
      classifyFailure({ diagnostic: { code: 'broken', text: 1, details: {} }, retryable: true })
        .retryable
    ).toBe(false));
});

it('saves an interrupted job without making another provider request', async () => {
  const { worker, repository, apply, operations } = setup();
  repository.claim.mockResolvedValueOnce(
    jobFixture({ id: 1, status: 'failed', stage: 'translate', leaseOwner: 'owner', prepared })
  );
  await worker.execute();
  expect(apply).not.toHaveBeenCalled();
  expect(operations).not.toHaveBeenCalled();
  expect(repository.completeStage).toHaveBeenCalledWith(
    expect.objectContaining({ status: 'failed' })
  );
});

import { runJobAttempt } from '../../server/src/worker';
import { messages } from '../../shared/messages';
it.each(['translate', 'enqueue'] as const)(
  'does not retry %s after uncertain provider acceptance',
  async (stage) => {
    const job = jobFixture({ id: 1, status: 'running', stage, prepared });
    const next = await runJobAttempt(job, {
      repository: setup().repository,
      operations: async () => {
        throw {
          diagnostic: messages.networkFailure('The response was lost'),
          retryable: true,
          acceptance: 'unknown',
        };
      },
      retryDelay: () => 1,
      log: () => undefined,
    });
    expect(next).toMatchObject({ status: 'failed', error: { code: 'interrupted-request' } });
  }
);
it('still backs off an explicit paid-stage rejection', async () => {
  const job = jobFixture({ id: 1, status: 'running', stage: 'translate', prepared });
  const next = await runJobAttempt(job, {
    repository: setup().repository,
    operations: async () => {
      throw {
        diagnostic: messages.providerFailure('GT rejected the request'),
        retryable: true,
        acceptance: 'rejected',
      };
    },
    retryDelay: () => 1,
    log: () => undefined,
  });
  expect(next.status).toBe('waiting');
  expect(next.error?.code).not.toBe('interrupted-request');
});
