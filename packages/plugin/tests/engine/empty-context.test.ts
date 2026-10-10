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

describe('empty-context compatibility and adversarial controls', () => {
  it('keeps missing context eligible for file translation', () => {
    expect(shouldUseFiles(prepare())).toBe(true);
  });
  it('preserves raw prepared settings, source text and segment fingerprints', () => {
    const hint = '\t \n';
    const input = prepareInput(
      { title: text },
      { rules: { title: { translate: true, context: hint } } }
    );
    const snapshot = structuredClone(input);
    const prepared = translationEngine.prepare(input);
    expect(input).toEqual(snapshot);
    expect(prepared.input.rules.title?.context).toBe(hint);
    expect(prepared.segments[0]?.context).toBe(hint);
    expect(
      translationEngine.apply(
        prepared,
        Object.fromEntries(prepared.segments.map((entry) => [entry.id, entry.text]))
      ).patch.title
    ).toBe(text);
  });
  it('keeps a small cleared-context request on runtime', async () => {
    const prepared = translationEngine.prepare(
      prepareInput(
        { title: '  Source text  ' },
        { rules: { title: { translate: true, context: '' } } }
      )
    );
    expect(shouldUseFiles(prepared)).toBe(false);
    const start = mock.requests.length;
    const translated = await client().translate({
      sourceLocale: 'en',
      targetLocale: 'fr',
      segments: prepared.segments,
    });
    expect(translationEngine.apply(prepared, translated).patch.title).toBe('  Source text  ');
    expect(mock.requests.slice(start).map((request) => request.path)).toEqual(['/v2/translate']);
  });
  it('treats ASCII and Unicode whitespace-only hints consistently', () => {
    for (const context of [' ', '\t', '\r\n', '\u00a0', '\u2003', '\u3000', '\ufeff'])
      expect(shouldUseFiles(prepare(context))).toBe(true);
  });
  it('retains any non-whitespace hint even if it is short or invisible', async () => {
    const start = mock.requests.length;
    for (const context of ['0', '.', 'ع', '\u200b']) {
      const prepared = prepare(context);
      expect(shouldUseFiles(prepared)).toBe(false);
      await expect(
        client().upload(
          { sourceLocale: 'en', targetLocale: 'fr', segments: prepared.segments },
          'must-not-upload.json'
        )
      ).rejects.toMatchObject({ acceptance: 'not-sent' });
    }
    expect(mock.requests).toHaveLength(start);
  });
  it('rejects file upload when a mixed request contains one real hint', async () => {
    const prepared = translationEngine.prepare(
      prepareInput(
        { title: text, summary: 'Bank' },
        {
          rules: {
            title: { translate: true, context: '' },
            summary: { translate: true, context: 'Financial institution' },
          },
        }
      )
    );
    const start = mock.requests.length;
    expect(shouldUseFiles(prepared)).toBe(false);
    await expect(
      client().upload(
        { sourceLocale: 'en', targetLocale: 'fr', segments: prepared.segments },
        'mixed.json'
      )
    ).rejects.toMatchObject({ acceptance: 'not-sent' });
    expect(mock.requests).toHaveLength(start);
  });
  it('retains a real inherited component hint', () => {
    const context = ' Editorial heading ';
    const prepared = translationEngine.prepare(
      prepareInput({ card: { heading: text } }, { rules: { card: { translate: true, context } } })
    );
    expect(prepared.segments[0]?.context).toBe(context);
    expect(shouldUseFiles(prepared)).toBe(false);
  });
  it('preserves an explicitly cleared child hint instead of restoring its parent hint', () => {
    const prepared = translationEngine.prepare(
      prepareInput(
        { card: { heading: text } },
        {
          rules: {
            card: { translate: true, context: 'Parent hint' },
            'card.heading': { translate: true, context: '' },
          },
        }
      )
    );
    expect(prepared.segments[0]?.context).toBe('');
    expect(shouldUseFiles(prepared)).toBe(true);
  });
  it('does not confuse whitespace-only source text with context or create remote work for it', () => {
    const title = ' \t\n'.repeat(4000);
    const prepared = translationEngine.prepare(
      prepareInput({ title }, { rules: { title: { translate: true, context: '' } } })
    );
    expect(prepared.segments).toEqual([]);
    expect(shouldUseFiles(prepared)).toBe(false);
    expect(translationEngine.apply(prepared, {}).patch.title).toBe(title);
  });
  it('preserves media source hashes while treating an empty media hint as absent', () => {
    const input = prepareInput(
      { photo: { id: 7, caption: text } },
      { mediaMetadata: true, rules: { photo: { translate: true, context: ' ' } } }
    );
    const prepared = translationEngine.prepare(input);
    const first = translationEngine.apply(
      prepared,
      Object.fromEntries(prepared.segments.map((entry) => [entry.id, entry.text]))
    );
    expect(shouldUseFiles(prepared)).toBe(true);
    const second = translationEngine.apply(
      structuredClone(prepared),
      Object.fromEntries(prepared.segments.map((entry) => [entry.id, entry.text]))
    );
    expect(second.media).toEqual(first.media);
    expect(input.source.photo).toEqual({ id: 7, caption: text });
  });
  it('resumes a persisted cleared-context runtime stage without invalidating completed chunks', async () => {
    const prepared = prepare('');
    const operations: JobOperations = {
      client: client(),
      prepare: async () => prepared,
      apply: async () => {},
    };
    const first = await transitionJob(
      jobFixture({
        stage: 'translate',
        prepared,
        settings: { ...DEFAULT_SETTINGS, projectId: 'editorial' },
      }),
      operations
    );
    expect(Object.keys(first.runtimeProgress ?? {}).length).toBeGreaterThan(1);
    const count = mock.requests.length;
    const resumed = await transitionJob(
      { ...structuredClone(first), stage: 'translate', translations: {} },
      operations
    );
    expect(resumed.translations).toEqual(first.translations);
    expect(mock.requests).toHaveLength(count);
  });
  it('keeps concurrent file uploads for different blank-context documents independent', async () => {
    const first = prepare('');
    const second = translationEngine.prepare(
      prepareInput(
        { title: 'Another source. '.repeat(1200) },
        { rules: { title: { translate: true, context: '\n' } } }
      )
    );
    const references = await Promise.all(
      [first, second].map((prepared, index) =>
        client().upload(
          { sourceLocale: 'en', targetLocale: 'fr', segments: prepared.segments },
          `blank-${index}.json`
        )
      )
    );
    expect(references[0]).not.toEqual(references[1]);
  });
});
