import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFixtureEvidence } from './fixture-evidence';
import { jobFixture } from './persistence-fixture';
import { messages } from '../../shared/messages';

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
});
const setup = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gt-evidence-'));
  directories.push(directory);
  return createFixtureEvidence(join(directory, 'events.jsonl'), ['http://127.0.0.1:43210']);
};

describe('shared fixture evidence', () => {
  it('retains terminal diagnostics and chunk counts without snapshots or credentials', async () => {
    const evidence = await setup();
    evidence.job(
      'completed',
      jobFixture({
        id: 7,
        status: 'failed',
        error: messages.invalidKey(),
        translations: { field: 'private translation' },
        runtimeProgress: { chunk: 'private confirmed text' },
        settings: { ...jobFixture().settings, projectId: 'private configuration' },
      }),
      true
    );
    await evidence.flush();
    const raw = await readFile(evidence.path, 'utf8');
    expect(raw).toContain('invalid-key');
    expect(raw).toContain('"storedChunkCount":1');
    expect(raw).not.toMatch(
      /private translation|private confirmed text|private configuration|"settings"|"prepared"|"translations"|"runtimeProgress"/
    );
    expect((await stat(evidence.path)).mode & 0o777).toBe(0o600);
    await evidence.close();
  });
  it('captures safe transport status without recording bodies, headers, or query strings', async () => {
    const fetch = vi.fn(async () => new Response('{}', { status: 429 }));
    vi.stubGlobal('fetch', fetch);
    const evidence = await setup();
    const result = await globalThis.fetch(
      'http://127.0.0.1:43210/v2/translate?token=private-query',
      { method: 'POST', headers: { Authorization: 'Bearer private-header' }, body: 'private body' }
    );
    expect(result.status).toBe(429);
    await evidence.flush();
    const raw = await readFile(evidence.path, 'utf8');
    expect(raw).toContain('"status":429');
    expect(raw).toContain('"path":"/v2/translate"');
    expect(raw).not.toMatch(/private-query|private-header|private body|Authorization/);
    await evidence.close();
    expect(globalThis.fetch).toBe(fetch);
  });
  it('captures a native transport cause safely and preserves rejection identity', async () => {
    const cause = Object.assign(new Error('socket closed token=private-cause'), {
      code: 'UND_ERR_SOCKET',
    });
    const failure = new Error('fetch failed gtx-private-fixture', { cause });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw failure;
      })
    );
    const evidence = await setup();
    await expect(globalThis.fetch('http://127.0.0.1:43210/v2/translate')).rejects.toBe(failure);
    await evidence.flush();
    const raw = await readFile(evidence.path, 'utf8');
    expect(raw).toContain('UND_ERR_SOCKET');
    expect(raw).not.toMatch(/private-cause|private-fixture/);
    await evidence.close();
  });
  it('does not record traffic outside its fixture origins', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}'))
    );
    const evidence = await setup();
    await globalThis.fetch('http://127.0.0.1:12345/unrelated');
    await evidence.flush();
    expect(await readFile(evidence.path, 'utf8')).not.toContain('/unrelated');
    await evidence.close();
  });
  it('preserves event order across overlapping flushes', async () => {
    const evidence = await setup();
    evidence.job('created', jobFixture({ id: 1 }));
    const first = evidence.flush();
    evidence.job('completed', jobFixture({ id: 2, status: 'succeeded' }), true);
    await Promise.all([first, evidence.flush()]);
    const raw = await readFile(evidence.path, 'utf8');
    expect(raw.indexOf('"id":1')).toBeLessThan(raw.indexOf('"id":2'));
    await evidence.close();
  });
});
