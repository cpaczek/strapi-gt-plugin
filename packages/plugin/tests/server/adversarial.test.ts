import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, RETRY_LIMIT, RETRY_BASE_MS } from '../../shared/constants';
import { messages } from '../../shared/messages';
import { validateSettings } from '../../server/src/settings';
import { runJobAttempt } from '../../server/src/worker';
import { DiagnosticError } from '../../server/src/validation';
import { transitionJob } from '../../server/src/jobs';
import type { StoredJob } from '../../server/src/validation';
import type { GtClient } from '../../shared/contracts';

const metadata = {
  locales: [
    { code: 'en', name: 'English' },
    { code: 'ar', name: 'Arabic' },
    { code: 'fr', name: 'French' },
  ],
  supportedLocales: ['en', 'ar', 'fr'],
  contentTypes: [],
  components: {},
  aiTranslationsEnabled: false,
};
const settings = { ...DEFAULT_SETTINGS, projectId: 'p', targetLocales: ['ar'] };
const initial: StoredJob = {
  id: 1,
  key: 'k',
  contentType: 'api::article.article',
  documentId: 'd',
  sourceLocale: 'en',
  targetLocale: 'ar',
  actorId: 1,
  force: false,
  status: 'running',
  stage: 'prepare',
  attempts: 0,
  nextRunAt: new Date(0).toISOString(),
  leaseOwner: 'o',
  leaseUntil: new Date().toISOString(),
  prepared: null,
  file: null,
  remoteJobIds: [],
  translations: {},
  error: null,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  settings,
  sourceStatus: 'draft',
  permission: 'translate',
};
const client: GtClient = {
  testConnection: async () => {
    throw new Error('unexpected');
  },
  translate: async () => ({}),
  upload: async () => {
    throw new Error('unexpected');
  },
  enqueue: async () => [],
  poll: async () => ({ status: 'pending' }),
  download: async () => ({}),
};
const failAttempt = (failure: unknown, job = initial) =>
  runJobAttempt(job, {
    operations: async () => {
      throw failure;
    },
    repository: {
      claim: async () => null,
      renew: async () => true,
      completeStage: async () => true,
    },
    retryDelay: () => RETRY_BASE_MS,
    log: () => undefined,
  });

describe('settings boundaries', () => {
  it('accepts an RTL target', () =>
    expect(validateSettings(settings, metadata).targetLocales).toEqual(['ar']));
  it('rejects duplicate targets', () =>
    expect(() =>
      validateSettings({ ...settings, targetLocales: ['ar', 'ar'] }, metadata)
    ).toThrow());
  it('rejects removed locales', () =>
    expect(() => validateSettings({ ...settings, targetLocales: ['de'] }, metadata)).toThrow());
  it('rejects unsupported explicit mappings', () =>
    expect(() =>
      validateSettings({ ...settings, localeMapping: { ar: 'qbr' } }, metadata)
    ).toThrow());
  it('rejects mappings for unknown Strapi locales', () =>
    expect(() =>
      validateSettings({ ...settings, localeMapping: { xx: 'ar' } }, metadata)
    ).toThrow());
  it('rejects unknown persisted settings', () =>
    expect(() => validateSettings({ ...settings, concurrency: 100 }, metadata)).toThrow());
  it('rejects arbitrary content UIDs', () =>
    expect(() =>
      validateSettings(
        { ...settings, contentTypes: { 'admin::user': { fields: {}, mediaMetadata: false } } },
        metadata
      )
    ).toThrow());
  it('keeps manual translation available with built-in AI enabled', () =>
    expect(
      validateSettings(settings, { ...metadata, aiTranslationsEnabled: true }).automaticMode
    ).toBe('off'));
  it('does not permit a locale without GT mapping', () =>
    expect(() => validateSettings(settings, { ...metadata, supportedLocales: ['en'] })).toThrow());
  it('rejects string booleans', () =>
    expect(() => validateSettings({ ...settings, autoPublish: 'true' }, metadata)).toThrow());
});

describe('worker failures', () => {
  it('stops on bad credentials', async () =>
    expect((await failAttempt(new DiagnosticError(messages.invalidKey()))).status).toBe('failed'));
  it('records stale source as conflict even when forced', async () =>
    expect(
      (await failAttempt(new DiagnosticError(messages.staleSource()), { ...initial, force: true }))
        .status
    ).toBe('conflict'));
  it('records an intervening human edit as conflict', async () =>
    expect((await failAttempt(new DiagnosticError(messages.humanEdit()))).status).toBe('conflict'));
  it('retries classified transport failures', async () =>
    expect(
      (await failAttempt({ diagnostic: messages.networkFailure('Unavailable'), retryable: true }))
        .status
    ).toBe('waiting'));
  it('bounds retries', async () =>
    expect(
      (
        await failAttempt(
          { diagnostic: messages.networkFailure('Unavailable'), retryable: true },
          { ...initial, attempts: RETRY_LIMIT - 1 }
        )
      ).status
    ).toBe('failed'));
  it('never includes an unexpected raw failure message', async () =>
    expect(JSON.stringify(await failAttempt(new Error('secret-value')))).not.toContain(
      'secret-value'
    ));
  it('honors retry-after', async () =>
    expect(
      Date.parse(
        (
          await failAttempt({
            diagnostic: messages.networkFailure('Limited'),
            retryable: true,
            retryAfterMs: 90_000,
          })
        ).nextRunAt
      )
    ).toBeGreaterThan(Date.now() + 80_000));
  it('keeps stage and remote IDs on failure', async () => {
    const next = await failAttempt(new Error('failure'), {
      ...initial,
      stage: 'poll',
      remoteJobIds: ['remote'],
    });
    expect(next.remoteJobIds).toEqual(['remote']);
    expect(next.stage).toBe('poll');
  });
  it('rejects a missing prepared snapshot', async () =>
    await expect(
      transitionJob(
        { ...initial, stage: 'apply' },
        {
          client,
          prepare: async () => {
            throw new Error('unexpected');
          },
          apply: async () => undefined,
        }
      )
    ).rejects.toThrow());
  it('does not treat an unknown exception as safe to retry', async () =>
    expect((await failAttempt(new Error('unknown'))).status).toBe('failed'));
});
