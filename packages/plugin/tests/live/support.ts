import { setTimeout } from 'node:timers/promises';
import { createGtClient, GtRequestError, resolveGtLocale } from '../../server/src/engine';
import { GT_BASE_URL, LIVE_SMOKE_TIMEOUT_MS, UI_POLL_MS } from '../../shared/constants';
import type { GtTranslationRequest } from '../../shared/contracts';
import { messages } from '../../shared/messages';

interface SmokeDependencies {
  createClient?: typeof createGtClient;
  wait?: () => Promise<unknown>;
  now?: () => number;
}

const requireTranslation = (translations: Record<string, string>, source: string): string => {
  const translated = translations.title;
  if (Object.keys(translations).length !== 1 || !translated?.trim() || translated === source)
    throw new GtRequestError(
      messages.validation('The smoke translation must contain one changed, nonempty title')
    );
  return translated;
};

export const runLiveSmoke = async (
  environment: Record<string, string | undefined>,
  dependencies: SmokeDependencies = {}
): Promise<{ targetLocale: string; runtime: string; file: string }> => {
  const apiKey = environment.GT_API_KEY?.trim();
  const projectId = environment.GT_PROJECT_ID?.trim();
  if (!apiKey) throw new GtRequestError(messages.missingKey());
  if (!projectId)
    throw new GtRequestError(
      messages.validation('Set GT_PROJECT_ID before running the live smoke test')
    );
  const targetLocale = resolveGtLocale(environment.GT_SMOKE_LOCALE || 'es', {});
  if (targetLocale.split('-')[0] === 'en')
    throw new GtRequestError(
      messages.validation('Choose a non-English GT_SMOKE_LOCALE for the English smoke fixture')
    );
  const client = (dependencies.createClient ?? createGtClient)({
    apiKey,
    projectId,
    baseUrl: GT_BASE_URL,
  });
  const project = await client.testConnection();
  if (project.sourceLocale.split('-')[0] !== 'en')
    throw new GtRequestError(
      messages.validation('Use a GT project with an English source locale for this smoke fixture')
    );
  const runtimeSource = 'The Enderman fan club is meeting tonight.';
  const fileSource = 'Letters from the End: please bring a grass block.';
  const request = (text: string): GtTranslationRequest => ({
    sourceLocale: project.sourceLocale,
    targetLocale,
    segments: [{ id: 'title', path: ['title'], text, kind: 'text' }],
  });
  const runtimeRequest = request(runtimeSource);
  const runtime = requireTranslation(
    await client.translate({
      ...runtimeRequest,
      segments: runtimeRequest.segments.map((segment) => ({
        ...segment,
        context:
          'A playful Minecraft Enderman fan club announcement. Preserve the character name Enderman.',
      })),
    }),
    runtimeSource
  );
  const fileRequest = request(fileSource);
  const reference = await client.upload(fileRequest, 'strapi-gt-smoke.json');
  const jobIds = await client.enqueue(reference, fileRequest, false);
  const now = dependencies.now ?? Date.now;
  const deadline = now() + LIVE_SMOKE_TIMEOUT_MS;
  const wait = dependencies.wait ?? (() => setTimeout(UI_POLL_MS));
  for (;;) {
    const result = await client.poll(reference, targetLocale, jobIds);
    if (result.status === 'failed') throw new GtRequestError(result.message);
    if (result.status === 'ready') break;
    if (now() >= deadline)
      throw new GtRequestError(
        messages.validation(
          'The live file translation reached its polling deadline; review the existing job in GT before running it again'
        )
      );
    await wait();
  }
  const file = requireTranslation(await client.download(reference, targetLocale), fileSource);
  return { targetLocale, runtime, file };
};
