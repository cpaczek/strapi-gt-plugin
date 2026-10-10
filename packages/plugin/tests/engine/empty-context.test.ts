import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createGtClient, translationEngine } from '../../server/src/engine';
import { shouldUseFiles, transitionJob, type JobOperations } from '../../server/src/jobs';
import type { PreparedTranslation, JsonObject } from '../../shared/contracts';
import { DEFAULT_SETTINGS } from '../../shared/constants';
import { prepareInput } from './fixtures';
import { jobFixture } from '../server/persistence-fixture';
import { startMockGt } from '../../../../tests/apps/acceptance/src/mock-gt';

const text = '  العربية 👩🏽‍🚀 e\u0301 remains source text.\n'.repeat(900);
const prepare = (context?: string): PreparedTranslation =>
  translationEngine.prepare(
    prepareInput(
      { title: text },
      { rules: { title: { translate: true, ...(context !== undefined ? { context } : {}) } } }
    )
  );
let mock: Awaited<ReturnType<typeof startMockGt>>;
beforeAll(async () => {
  mock = await startMockGt({ apiKey: 'empty-context-test-key', identity: true });
});
afterAll(async () => {
  await mock.close();
});
const client = () =>
  createGtClient({ apiKey: 'empty-context-test-key', projectId: 'editorial', baseUrl: mock.url });
const uploadBody = z.object({
  data: z.array(
    z.object({ source: z.object({ content: z.string(), fileFormat: z.literal('JSON') }) })
  ),
});
const runtimeBody = z.object({
  requests: z.record(
    z.string(),
    z.object({ source: z.string(), metadata: z.object({ context: z.string().optional() }) })
  ),
});

describe('cleared context across preparation and transport', () => {
  it.each([
    { name: 'new empty', context: '', persisted: false },
    { name: 'new whitespace', context: ' \t\r\n ', persisted: false },
    { name: 'persisted empty', context: '', persisted: true },
    { name: 'persisted whitespace', context: '\u00a0\u2003', persisted: true },
  ])(
    'completes the file pipeline for $name hints without changing source text',
    async ({ context, persisted }) => {
      const initial = prepare(context);
      const prepared = persisted
        ? {
            ...structuredClone(initial),
            segments: initial.segments.map((entry) => ({ ...entry, context })),
          }
        : initial;
      const snapshot = structuredClone(prepared);
      expect(shouldUseFiles(prepared)).toBe(true);
      const start = mock.requests.length;
      let patch: JsonObject | undefined;
      const operations: JobOperations = {
        client: client(),
        prepare: async () => prepared,
        apply: async (job, plan) => {
          patch = translationEngine.apply(plan, job.translations).patch;
        },
      };
      let job = await transitionJob(
        jobFixture({ stage: 'prepare', settings: { ...DEFAULT_SETTINGS, projectId: 'editorial' } }),
        operations
      );
      for (const stage of ['upload', 'enqueue', 'poll', 'download', 'apply']) {
        expect(job.stage).toBe(stage);
        job = await transitionJob(job, operations);
      }
      expect(job.status).toBe('succeeded');
      expect(patch).toEqual({ title: text });
      expect(prepared).toEqual(snapshot);
      const receipts = mock.requests.slice(start);
      expect(receipts.some((request) => request.path === '/v2/translate')).toBe(false);
      const uploaded = receipts.find(
        (request) => request.path === '/v2/project/files/upload-files'
      );
      const content = uploaded && uploadBody.parse(uploaded.body).data[0]?.source.content;
      if (!content) throw new Error('Expected recorded source file');
      const uploadedText: unknown = JSON.parse(Buffer.from(content, 'base64').toString('utf8'));
      expect(uploadedText).toEqual(
        Object.fromEntries(prepared.segments.map((entry) => [entry.id, entry.text]))
      );
    }
  );
  it('keeps large genuinely contextual text on runtime and passes the exact hint', async () => {
    const context = ' \n River bank, not a financial institution. \t';
    const prepared = prepare(context);
    expect(shouldUseFiles(prepared)).toBe(false);
    const start = mock.requests.length;
    const translated = await client().translate({
      sourceLocale: 'en',
      targetLocale: 'fr',
      segments: prepared.segments,
    });
    expect(translationEngine.apply(prepared, translated).patch.title).toBe(text);
    const receipts = mock.requests.slice(start);
    expect(receipts.length).toBeGreaterThan(1);
    expect(receipts.every((request) => request.path === '/v2/translate')).toBe(true);
    for (const request of receipts)
      for (const entry of Object.values(runtimeBody.parse(request.body).requests))
        expect(entry.metadata.context).toBe(context);
  });
});
