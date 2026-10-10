import { describe, expect, it, vi } from 'vitest';
import type { GtClient } from '../shared/contracts';
import { GT_BASE_URL } from '../shared/constants';
import { messages } from '../shared/messages';
import { runLiveSmoke } from './live/support';

const environment = { GT_API_KEY: 'test-key', GT_PROJECT_ID: 'test-project' };
const reference = { fileId: 'file', versionId: 'version', branchId: 'branch' };
const fixture = () => {
  const client = {
    testConnection: vi.fn<GtClient['testConnection']>().mockResolvedValue({
      id: 'test-project',
      name: 'Test',
      sourceLocale: 'en',
      locales: ['es'],
    }),
    translate: vi.fn<GtClient['translate']>().mockResolvedValue({ title: 'El club del Enderman' }),
    upload: vi.fn<GtClient['upload']>().mockResolvedValue(reference),
    enqueue: vi.fn<GtClient['enqueue']>().mockResolvedValue(['job']),
    poll: vi.fn<GtClient['poll']>().mockResolvedValue({ status: 'ready' }),
    download: vi.fn<GtClient['download']>().mockResolvedValue({ title: 'Cartas desde el End' }),
  } satisfies GtClient;
  return {
    client,
    options: {
      createClient: vi.fn(() => client),
      wait: vi.fn(async () => undefined),
      now: vi.fn(() => 0),
    },
  };
};

describe('opt-in live verification', () => {
  it.each(['GT_API_KEY', 'GT_PROJECT_ID'] as const)(
    'fails before network access without %s',
    async (missing) => {
      const { options } = fixture();
      await expect(runLiveSmoke({ ...environment, [missing]: '' }, options)).rejects.toThrow(
        'General Translation:'
      );
      expect(options.createClient).not.toHaveBeenCalled();
    }
  );
  it('uses only the official GT host and preserves contextual runtime text', async () => {
    const { client, options } = fixture();
    await runLiveSmoke({ ...environment, GT_BASE_URL: 'https://attacker.invalid' }, options);
    expect(options.createClient).toHaveBeenCalledWith({
      ...{ apiKey: 'test-key', projectId: 'test-project' },
      baseUrl: GT_BASE_URL,
    });
    expect(client.translate).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceLocale: 'en',
        targetLocale: 'es',
        segments: [expect.objectContaining({ context: expect.stringContaining('Enderman') })],
      })
    );
  });
  it('rejects a project with another source language before paid translation', async () => {
    const { client, options } = fixture();
    client.testConnection.mockResolvedValue({
      id: 'test-project',
      name: 'Test',
      sourceLocale: 'ja',
      locales: [],
    });
    await expect(runLiveSmoke(environment, options)).rejects.toThrow('English');
    expect(client.translate).not.toHaveBeenCalled();
    expect(client.upload).not.toHaveBeenCalled();
  });
  it('rejects an unsupported target without contacting GT', async () => {
    const { options } = fixture();
    await expect(
      runLiveSmoke({ ...environment, GT_SMOKE_LOCALE: 'zz-ZZ' }, options)
    ).rejects.toThrow();
    expect(options.createClient).not.toHaveBeenCalled();
  });
  it('rejects the source language as a target before paid work', async () => {
    const { client, options } = fixture();
    await expect(
      runLiveSmoke({ ...environment, GT_SMOKE_LOCALE: 'en' }, options)
    ).rejects.toThrow();
    expect(client.translate).not.toHaveBeenCalled();
  });
  it('retains exact file references and avoids forced generation', async () => {
    const { client, options } = fixture();
    await expect(runLiveSmoke(environment, options)).resolves.toEqual({
      targetLocale: 'es',
      runtime: 'El club del Enderman',
      file: 'Cartas desde el End',
    });
    expect(client.enqueue).toHaveBeenCalledWith(
      reference,
      expect.objectContaining({ targetLocale: 'es' }),
      false
    );
    expect(client.poll).toHaveBeenCalledWith(reference, 'es', ['job']);
    expect(client.download).toHaveBeenCalledWith(reference, 'es');
  });
  it('waits for readiness even when enqueue returns a cached result', async () => {
    const { client, options } = fixture();
    client.enqueue.mockResolvedValue([]);
    client.poll.mockResolvedValueOnce({ status: 'pending' });
    await runLiveSmoke(environment, options);
    expect(options.wait).toHaveBeenCalledOnce();
    expect(client.poll).toHaveBeenCalledTimes(2);
    expect(client.download).toHaveBeenCalledOnce();
  });
  it('stops pending polls at the deadline without downloading', async () => {
    const { client, options } = fixture();
    client.poll.mockResolvedValue({ status: 'pending' });
    options.now.mockReturnValueOnce(0).mockReturnValue(Number.MAX_SAFE_INTEGER);
    await expect(runLiveSmoke(environment, options)).rejects.toThrow('deadline');
    expect(client.download).not.toHaveBeenCalled();
  });
  it('reports a failed remote job without downloading', async () => {
    const { client, options } = fixture();
    client.poll.mockResolvedValue({ status: 'failed', message: messages.quotaExhausted() });
    await expect(runLiveSmoke(environment, options)).rejects.toThrow('General Translation:');
    expect(client.download).not.toHaveBeenCalled();
  });
  it.each<Record<string, string>>([
    { title: '' },
    { extra: 'Unexpected' },
    { title: 'The Enderman fan club is meeting tonight.' },
  ])('rejects incomplete or unchanged runtime output %j', async (output) => {
    const { client, options } = fixture();
    client.translate.mockResolvedValue(output);
    await expect(runLiveSmoke(environment, options)).rejects.toThrow();
    expect(client.upload).not.toHaveBeenCalled();
  });
  it('rejects extra file output identities', async () => {
    const { client, options } = fixture();
    client.download.mockResolvedValue({ title: 'Cartas', unexpected: 'Extra' });
    await expect(runLiveSmoke(environment, options)).rejects.toThrow();
  });
});
