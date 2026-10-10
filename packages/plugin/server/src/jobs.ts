import { RUNTIME_BATCH_BYTES, RUNTIME_BATCH_ENTRIES, WORKER_POLL_MS } from '../../shared/constants';
import type { GtClient, GtTranslationRequest, PreparedTranslation } from '../../shared/contracts';
import { hasTranslationContext } from './engine/context';
import { DiagnosticError, fail, type StoredJob } from './validation';

export interface JobOperations {
  client: GtClient;
  prepare(job: StoredJob): Promise<PreparedTranslation>;
  apply(job: StoredJob, prepared: PreparedTranslation): Promise<void>;
  checkpoint?(completed: Record<string, string>): Promise<void>;
}
export const shouldUseFiles = (prepared: PreparedTranslation): boolean =>
  prepared.segments.every((segment) => !hasTranslationContext(segment.context)) &&
  (prepared.segments.length > RUNTIME_BATCH_ENTRIES ||
    Buffer.byteLength(JSON.stringify(prepared.segments), 'utf8') > RUNTIME_BATCH_BYTES);

export const transitionJob = async (
  job: StoredJob,
  operations: JobOperations
): Promise<StoredJob> => {
  if (job.stage === 'prepare') {
    const prepared = await operations.prepare(job);
    return {
      ...job,
      prepared,
      stage: prepared.segments.length
        ? shouldUseFiles(prepared)
          ? 'upload'
          : 'translate'
        : 'apply',
    };
  }
  if (!job.prepared) return fail('The job has no saved source snapshot; start a new translation');
  const request: GtTranslationRequest = {
    sourceLocale: job.settings.localeMapping[job.sourceLocale] ?? job.sourceLocale,
    targetLocale: job.settings.localeMapping[job.targetLocale] ?? job.targetLocale,
    segments: job.prepared.segments,
  };
  switch (job.stage) {
    case 'translate': {
      const translations = await operations.client.translate(request, {
        completed: job.runtimeProgress ?? {},
        onProgress: async (completed) => {
          if (operations.checkpoint) await operations.checkpoint(completed);
          job.runtimeProgress = { ...completed };
        },
      });
      return { ...job, translations, stage: 'apply' };
    }
    case 'upload':
      return {
        ...job,
        file: await operations.client.upload(request, `strapi-${job.id}.json`),
        stage: 'enqueue',
      };
    case 'enqueue': {
      if (!job.file) return fail('The saved GT file identity is missing; start a new translation');
      return {
        ...job,
        remoteJobIds: await operations.client.enqueue(job.file, request, job.force),
        stage: 'poll',
      };
    }
    case 'poll': {
      if (!job.file) return fail('The saved GT file identity is missing; start a new translation');
      const result = await operations.client.poll(job.file, request.targetLocale, job.remoteJobIds);
      if (result.status === 'failed') throw new DiagnosticError(result.message);
      return result.status === 'ready'
        ? { ...job, stage: 'download' }
        : {
            ...job,
            status: 'waiting',
            nextRunAt: new Date(Date.now() + WORKER_POLL_MS).toISOString(),
          };
    }
    case 'download': {
      if (!job.file) return fail('The saved GT file identity is missing; start a new translation');
      return {
        ...job,
        translations: await operations.client.download(job.file, request.targetLocale),
        stage: 'apply',
      };
    }
    case 'apply':
      await operations.apply(job, job.prepared);
      return { ...job, status: 'succeeded', error: null };
  }
};
