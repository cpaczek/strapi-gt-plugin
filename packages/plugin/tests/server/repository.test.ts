import { afterEach, describe, expect, it, vi } from 'vitest';
import { JOB_LEASE_MS, WORKER_CONCURRENCY } from '../../shared/constants';
import { createRepository, documentKey, summarizeJob } from '../../server/src/repository';
import { jobFixture, persistenceFixture } from './persistence-fixture';

afterEach(() => vi.useRealTimers());
describe('durable queue persistence', () => {
  it('reconstructs a queued job after the service is recreated', async () => {
    const { host } = persistenceFixture();
    const first = await createRepository(host).create(jobFixture());
    expect(await createRepository(host).get(first.id)).toEqual(first);
  });
  it('claims a record once across concurrent workers', async () => {
    const { host } = persistenceFixture();
    const repository = createRepository(host);
    await repository.create(jobFixture());
    const claims = await Promise.all([repository.claim(), repository.claim()]);
    expect(claims.filter(Boolean)).toHaveLength(1);
  });
  it('limits global concurrency across distinct documents', async () => {
    const { host } = persistenceFixture();
    const repository = createRepository(host);
    for (let index = 0; index < WORKER_CONCURRENCY + 1; index += 1)
      await repository.create(jobFixture({ key: String(index) }));
    const claims = await Promise.all(
      Array.from({ length: WORKER_CONCURRENCY + 1 }, () => repository.claim())
    );
    expect(claims.filter(Boolean)).toHaveLength(WORKER_CONCURRENCY);
  });
  it('prevents overlapping stages for one document locale', async () => {
    const { host } = persistenceFixture();
    const repository = createRepository(host);
    await repository.create(jobFixture());
    await repository.create(jobFixture());
    const first = await repository.claim();
    expect(first).not.toBeNull();
    expect(await repository.claim()).toBeNull();
  });
  it('recovers an expired running job without replacing remote identity', async () => {
    vi.useFakeTimers();
    const { host } = persistenceFixture();
    const repository = createRepository(host);
    await repository.create(
      jobFixture({
        stage: 'poll',
        remoteJobIds: ['remote'],
        file: { fileId: 'file', versionId: 'version', branchId: 'branch' },
      })
    );
    const original = await repository.claim();
    vi.setSystemTime(Date.now() + JOB_LEASE_MS + 1);
    const recovered = await createRepository(host).claim();
    expect(recovered?.remoteJobIds).toEqual(['remote']);
    expect(recovered?.file?.versionId).toBe('version');
    expect(recovered?.leaseOwner).not.toBe(original?.leaseOwner);
  });
  it('refuses a stale worker completion after another worker claims', async () => {
    vi.useFakeTimers();
    const { host } = persistenceFixture();
    const repository = createRepository(host);
    await repository.create(jobFixture());
    const original = await repository.claim();
    if (!original) throw new Error('Expected claim');
    vi.setSystemTime(Date.now() + JOB_LEASE_MS + 1);
    const recovered = await repository.claim();
    expect(await repository.completeStage({ ...original, status: 'succeeded' })).toBe(false);
    expect(await repository.get(original.id)).toMatchObject({
      leaseOwner: recovered?.leaseOwner,
      status: 'running',
    });
  });
  it('persists a stage and releases both leases together', async () => {
    const { host } = persistenceFixture();
    const repository = createRepository(host);
    const queued = await repository.create(jobFixture());
    const claimed = await repository.claim();
    if (!claimed) throw new Error('Expected claim');
    expect(
      await repository.completeStage({ ...claimed, stage: 'poll', remoteJobIds: ['id'] })
    ).toBe(true);
    expect(await repository.get(queued.id)).toMatchObject({
      stage: 'poll',
      status: 'queued',
      remoteJobIds: ['id'],
      leaseOwner: null,
    });
    expect(await repository.claim()).not.toBeNull();
  });
  it('does not claim a job before its due time', async () => {
    const { host } = persistenceFixture();
    const repository = createRepository(host);
    await repository.create(
      jobFixture({ nextRunAt: new Date(Date.now() + JOB_LEASE_MS).toISOString() })
    );
    expect(await repository.claim()).toBeNull();
  });
  it('does not claim terminal states', async () => {
    const { host } = persistenceFixture();
    const repository = createRepository(host);
    for (const status of ['succeeded', 'failed', 'conflict'] as const)
      await repository.create(jobFixture({ status }));
    expect(await repository.claim()).toBeNull();
  });
  it('renews leases only while still owned', async () => {
    const { host } = persistenceFixture();
    const repository = createRepository(host);
    await repository.create(jobFixture());
    const claimed = await repository.claim();
    if (!claimed) throw new Error('Expected claim');
    expect(await repository.renew(claimed)).toBe(true);
    expect(await repository.owns(claimed)).toBe(true);
    expect(await repository.renew({ ...claimed, leaseOwner: 'another' })).toBe(false);
  });
  it('lists only the initiating actor history', async () => {
    const { host } = persistenceFixture();
    const repository = createRepository(host);
    await repository.create(jobFixture());
    await repository.create(jobFixture({ actorId: 8 }));
    const history = await repository.list(7, { page: 1 });
    expect(history.total).toBe(1);
    expect(history.jobs).toHaveLength(1);
  });
  it('filters history by document identity', async () => {
    const { host } = persistenceFixture();
    const repository = createRepository(host);
    await repository.create(jobFixture());
    const history = await repository.list(7, {
      page: 1,
      contentType: 'api::article.article',
      documentId: 'other',
    });
    expect(history.total).toBe(0);
  });
  it('retries failed records while retaining their paid remote work', async () => {
    const { host } = persistenceFixture();
    const repository = createRepository(host);
    const failed = await repository.create(
      jobFixture({ status: 'failed', stage: 'download', remoteJobIds: ['paid'] })
    );
    expect(await repository.retry(failed)).toMatchObject({
      status: 'queued',
      stage: 'download',
      remoteJobIds: ['paid'],
    });
  });
  it('refuses retry of succeeded or conflicted records', async () => {
    const { host } = persistenceFixture();
    const repository = createRepository(host);
    const succeeded = await repository.create(jobFixture({ status: 'succeeded' }));
    await expect(repository.retry(succeeded)).rejects.toThrow();
  });
  it('keeps publication snapshots independent', async () => {
    const { host } = persistenceFixture();
    const repository = createRepository(host);
    const draft = {
      checkpoints: { title: { sourceHash: 's', targetHash: 't' } },
      media: [],
      appliedJob: 7,
    };
    await repository.saveState('article', 'doc', 'fr', 'draft', draft);
    expect(await repository.state('article', 'doc', 'fr', 'published')).toEqual({
      checkpoints: {},
      media: [],
      appliedJob: null,
    });
    expect(await repository.state('article', 'doc', 'fr', 'draft')).toEqual(draft);
  });
  it('updates state and deletes only the selected publication variant', async () => {
    const { host } = persistenceFixture();
    const repository = createRepository(host);
    await repository.saveState('article', 'doc', 'fr', 'draft', {
      checkpoints: {},
      media: [],
      appliedJob: 1,
    });
    await repository.saveState('article', 'doc', 'fr', 'draft', {
      checkpoints: {},
      media: [],
      appliedJob: 2,
    });
    await repository.saveState('article', 'doc', 'fr', 'published', {
      checkpoints: {},
      media: [],
      appliedJob: 1,
    });
    await repository.deleteState('article', 'doc', 'fr', 'draft');
    expect((await repository.state('article', 'doc', 'fr', 'draft')).appliedJob).toBeNull();
    expect((await repository.state('article', 'doc', 'fr', 'published')).appliedJob).toBe(1);
  });
  it('uses unambiguous document keys and safe summaries', () => {
    expect(documentKey('a:b', 'c', 'fr')).not.toBe(documentKey('a', 'b:c', 'fr'));
    expect(summarizeJob(jobFixture())).not.toHaveProperty('prepared');
    expect(summarizeJob(jobFixture())).not.toHaveProperty('settings');
  });
});

it.each(['translate', 'enqueue'] as const)(
  'does not automatically repeat an interrupted paid %s request',
  async (stage) => {
    vi.useFakeTimers();
    const { host } = persistenceFixture();
    const repository = createRepository(host);
    await repository.create(jobFixture({ stage }));
    await repository.claim();
    vi.setSystemTime(Date.now() + JOB_LEASE_MS + 1);
    const recovered = await repository.claim();
    expect(recovered).toMatchObject({ status: 'failed', error: { code: 'interrupted-request' } });
  }
);

it('returns each locale latest job even beyond the history page size', async () => {
  const { host } = persistenceFixture();
  const repository = createRepository(host);
  const arabic = await repository.create(jobFixture({ targetLocale: 'ar', status: 'succeeded' }));
  for (let index = 0; index < 30; index += 1)
    await repository.create(jobFixture({ targetLocale: 'fr', status: 'succeeded' }));
  const response = await repository.latest('api::article.article', 'document', ['fr', 'ar']);
  expect(response).toHaveLength(2);
  expect(response.find((job) => job.targetLocale === 'ar')?.id).toBe(arabic.id);
  expect(response.find((job) => job.targetLocale === 'fr')?.id).toBe(arabic.id + 30);
});

it('persists runtime chunks under the existing lease before a worker restarts', async () => {
  const { host } = persistenceFixture();
  const repository = createRepository(host);
  await repository.create(jobFixture({ stage: 'translate' }));
  const job = await repository.claim();
  if (!job) throw new Error('No lease');
  expect(await repository.saveProgress(job, { chunk: 'Translated' })).toBe(true);
  expect((await createRepository(host).get(job.id))?.runtimeProgress).toEqual({
    chunk: 'Translated',
  });
  expect(await repository.owns(job)).toBe(true);
});
it('rejects runtime chunk checkpoints from a stale owner', async () => {
  const { host } = persistenceFixture();
  const repository = createRepository(host);
  await repository.create(jobFixture({ stage: 'translate' }));
  const job = await repository.claim();
  if (!job) throw new Error('No lease');
  expect(await repository.saveProgress({ ...job, leaseOwner: 'stale' }, { chunk: 'Wrong' })).toBe(
    false
  );
  expect((await repository.get(job.id))?.runtimeProgress ?? {}).toEqual({});
});
it('retains a durable chunk checkpoint when a later stage attempt fails', async () => {
  const { host } = persistenceFixture();
  const repository = createRepository(host);
  await repository.create(jobFixture({ stage: 'translate' }));
  const job = await repository.claim();
  if (!job) throw new Error('No lease');
  await repository.saveProgress(job, { chunk: 'Translated' });
  await repository.completeStage({ ...job, status: 'waiting' });
  expect((await repository.get(job.id))?.runtimeProgress).toEqual({ chunk: 'Translated' });
});
