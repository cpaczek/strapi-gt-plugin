import { describe, expect, it } from 'vitest';
import { transitionJob, shouldUseFiles } from '../../server/src/jobs';
import { DEFAULT_SETTINGS } from '../../shared/constants';
import type { GtClient, PreparedTranslation } from '../../shared/contracts';

const prepared: PreparedTranslation = {
  input: {
    schema: { uid: 'api::article.article', localized: true, draftAndPublish: true, attributes: {} },
    components: {},
    source: { title: 'Hello' },
    target: null,
    rules: {},
    checkpoints: {},
    force: false,
    mediaMetadata: false,
  },
  sourceHash: 'source',
  targetHash: 'target',
  segments: [{ id: 'title', path: ['title'], text: 'Hello', kind: 'text' }],
  protectedPaths: [],
  unchangedPaths: [],
};
const client: GtClient = {
  testConnection: async () => ({
    id: 'project',
    name: 'Project',
    sourceLocale: 'en',
    locales: ['fr'],
  }),
  translate: async () => ({ title: 'Bonjour' }),
  upload: async () => ({ fileId: 'file', versionId: 'version', branchId: 'branch' }),
  enqueue: async () => ['remote'],
  poll: async () => ({ status: 'ready' }),
  download: async () => ({ title: 'Bonjour' }),
};
const job = () =>
  ({
    id: 1,
    key: 'key',
    contentType: 'api::article.article',
    documentId: 'doc',
    sourceLocale: 'en',
    targetLocale: 'fr',
    actorId: 1,
    force: false,
    status: 'running',
    stage: 'prepare',
    attempts: 0,
    nextRunAt: '2026-10-10T00:00:00.000Z',
    leaseOwner: 'lease',
    leaseUntil: '2026-10-10T00:02:00.000Z',
    prepared: null,
    file: null,
    remoteJobIds: [],
    translations: {},
    error: null,
    createdAt: '2026-10-10T00:00:00.000Z',
    updatedAt: '2026-10-10T00:00:00.000Z',
    settings: { ...DEFAULT_SETTINGS, projectId: 'project' },
    sourceStatus: 'draft',
    permission: 'translate',
  }) as const;

describe('durable translation stages', () => {
  it('prepares without making a remote request', async () => {
    const next = await transitionJob(job(), {
      prepare: async () => prepared,
      apply: async () => undefined,
      client,
    });
    expect(next.stage).toBe('translate');
    expect(next.prepared).toEqual(prepared);
  });
  it('persists uploaded identity before enqueue', async () => {
    const next = await transitionJob(
      { ...job(), stage: 'upload', prepared },
      { prepare: async () => prepared, apply: async () => undefined, client }
    );
    expect(next.stage).toBe('enqueue');
    expect(next.file?.versionId).toBe('version');
  });
  it('resumes polling existing remote work', async () => {
    const next = await transitionJob(
      {
        ...job(),
        stage: 'poll',
        prepared,
        file: { fileId: 'file', versionId: 'version', branchId: 'branch' },
        remoteJobIds: ['remote'],
      },
      { prepare: async () => prepared, apply: async () => undefined, client }
    );
    expect(next.stage).toBe('download');
  });
  it('never routes contextual fields through undocumented file metadata', () => {
    expect(
      shouldUseFiles({
        ...prepared,
        segments: [
          { ...prepared.segments[0]!, text: 'x'.repeat(20_000), context: 'Article title' },
        ],
      })
    ).toBe(false);
  });
  it('only marks success after application completes', async () => {
    await expect(
      transitionJob(
        { ...job(), stage: 'apply', prepared },
        {
          prepare: async () => prepared,
          apply: async () => {
            throw new Error('Conflict');
          },
          client,
        }
      )
    ).rejects.toThrow('Conflict');
  });
});
