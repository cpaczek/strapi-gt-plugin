import { randomUUID } from 'node:crypto';
import type { PersistenceHost } from './persistence';
import { z } from 'zod';
import { messages } from '../../shared/messages';
import {
  JOB_LEASE_MS,
  PLUGIN_ID,
  WORKER_CONCURRENCY,
  JOB_HISTORY_PAGE_SIZE,
} from '../../shared/constants';
import type { FieldCheckpoint, JobSummary } from '../../shared/contracts';
import { checkpointsSchema, jobSchema, type StoredJob, objectRecord, fail } from './validation';
import { overlaySchema, type MediaOverlay } from './media';

const jobUid = `plugin::${PLUGIN_ID}.job`;
const leaseUid = `plugin::${PLUGIN_ID}.lease`;
const stateUid = `plugin::${PLUGIN_ID}.state`;
const countSchema = z.object({ count: z.number().int().nonnegative() });
const rowSchema = z.object({
  id: z.number(),
  payload: z.unknown(),
  status: z.string(),
  leaseOwner: z.string().nullable(),
  leaseUntil: z.union([z.string(), z.date()]).nullable(),
});
export interface TranslationState {
  checkpoints: Record<string, FieldCheckpoint>;
  media: MediaOverlay[];
  appliedJob: number | null;
}
const stateSchema = z.object({
  checkpoints: checkpointsSchema.nullable(),
  media: z.array(overlaySchema).nullable(),
  appliedJob: z.number().nullable(),
});
export const documentKey = (contentType: string, documentId: string, locale: string): string =>
  JSON.stringify([contentType, documentId, locale]);
export const summarizeJob = (job: StoredJob): JobSummary => ({
  id: job.id,
  contentType: job.contentType,
  documentId: job.documentId,
  sourceLocale: job.sourceLocale,
  targetLocale: job.targetLocale,
  status: job.status,
  stage: job.stage,
  attempts: job.attempts,
  error: job.error,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
});
const decode = (row: unknown): StoredJob => {
  const record = rowSchema.parse(row);
  if (!objectRecord(record.payload))
    return fail('The saved job is invalid; start a new translation');
  return jobSchema.parse({
    ...record.payload,
    id: record.id,
    status: record.status,
    leaseOwner: record.leaseOwner,
    leaseUntil:
      record.leaseUntil instanceof Date ? record.leaseUntil.toISOString() : record.leaseUntil,
  });
};
const jobColumns = (job: StoredJob) => ({
  key: job.key,
  status: job.status,
  nextRunAt: job.nextRunAt,
  leaseOwner: job.leaseOwner,
  leaseUntil: job.leaseUntil,
  actorId: job.actorId,
  contentType: job.contentType,
  entryDocumentId: job.documentId,
  targetLocale: job.targetLocale,
  payload: job,
});
export const createRepository = (strapi: PersistenceHost) => {
  const ensureLease = async (key: string): Promise<void> => {
    const found: unknown = await strapi.db.query(leaseUid).findOne({ where: { key } });
    if (found) return;
    try {
      await strapi.db.query(leaseUid).create({ data: { key, owner: null, expiresAt: null } });
    } catch (failure) {
      const raced: unknown = await strapi.db.query(leaseUid).findOne({ where: { key } });
      if (!raced) throw failure;
    }
  };
  const takeLease = async (
    key: string,
    owner: string,
    now: string,
    until: string
  ): Promise<boolean> => {
    await ensureLease(key);
    const result: unknown = await strapi.db.query(leaseUid).updateMany({
      where: { key, $or: [{ owner: null }, { expiresAt: { $lt: now } }] },
      data: { owner, expiresAt: until },
    });
    return countSchema.parse(result).count === 1;
  };
  const release = async (owner: string): Promise<void> => {
    await strapi.db
      .query(leaseUid)
      .updateMany({ where: { owner }, data: { owner: null, expiresAt: null } });
  };
  const state = async (
    contentType: string,
    documentId: string,
    locale: string,
    variant: string
  ): Promise<TranslationState> => {
    const row: unknown = await strapi.db
      .query(stateUid)
      .findOne({ where: { key: documentKey(contentType, documentId, locale) + variant } });
    if (!row) return { checkpoints: {}, media: [], appliedJob: null };
    const parsed = stateSchema.parse(row);
    return {
      checkpoints: parsed.checkpoints ?? {},
      media: parsed.media ?? [],
      appliedJob: parsed.appliedJob,
    };
  };
  const saveState = async (
    contentType: string,
    documentId: string,
    locale: string,
    variant: string,
    value: TranslationState
  ): Promise<void> => {
    const key = documentKey(contentType, documentId, locale) + variant;
    const columns = { key, contentType, entryDocumentId: documentId, locale, variant, ...value };
    const existing: unknown = await strapi.db.query(stateUid).findOne({ where: { key } });
    if (existing) await strapi.db.query(stateUid).update({ where: { key }, data: columns });
    else await strapi.db.query(stateUid).create({ data: columns });
  };
  return {
    state,
    saveState,
    release,
    async create(job: StoredJob): Promise<StoredJob> {
      return decode(await strapi.db.query(jobUid).create({ data: jobColumns(job) }));
    },
    async get(id: number): Promise<StoredJob | null> {
      const row: unknown = await strapi.db.query(jobUid).findOne({ where: { id } });
      return row ? decode(row) : null;
    },
    async list(
      actorId: number,
      filters: { contentType?: string; documentId?: string; page: number }
    ): Promise<{ jobs: StoredJob[]; total: number }> {
      const where = {
        actorId,
        ...(filters.contentType ? { contentType: filters.contentType } : {}),
        ...(filters.documentId ? { entryDocumentId: filters.documentId } : {}),
      };
      const rows: unknown = await strapi.db.query(jobUid).findMany({
        where,
        orderBy: { id: 'desc' },
        limit: JOB_HISTORY_PAGE_SIZE,
        offset: (filters.page - 1) * JOB_HISTORY_PAGE_SIZE,
      });
      const total: unknown = await strapi.db.query(jobUid).count({ where });
      return { jobs: z.array(z.unknown()).parse(rows).map(decode), total: z.number().parse(total) };
    },
    async latest(
      actorId: number,
      contentType: string,
      documentId: string,
      targetLocales: string[]
    ): Promise<StoredJob[]> {
      const records = await Promise.all(
        targetLocales.map(async (targetLocale) => {
          const row: unknown = await strapi.db.query(jobUid).findOne({
            where: { actorId, contentType, entryDocumentId: documentId, targetLocale },
            orderBy: { id: 'desc' },
          });
          return row ? decode(row) : null;
        })
      );
      return records.filter((job): job is StoredJob => job !== null);
    },
    async active(key: string): Promise<StoredJob | null> {
      const row: unknown = await strapi.db.query(jobUid).findOne({
        where: { key, status: { $in: ['queued', 'running', 'waiting'] } },
        orderBy: { id: 'asc' },
      });
      return row ? decode(row) : null;
    },
    async claim(): Promise<StoredJob | null> {
      const owner = randomUUID();
      const now = new Date().toISOString();
      const until = new Date(Date.now() + JOB_LEASE_MS).toISOString();
      let acquired = false;
      for (let slot = 0; slot < WORKER_CONCURRENCY; slot += 1) {
        if (await takeLease(`slot:${slot}`, owner, now, until)) {
          acquired = true;
          break;
        }
      }
      if (!acquired) return null;
      try {
        const due = {
          status: { $in: ['queued', 'waiting', 'running'] },
          nextRunAt: { $lte: now },
          $or: [{ leaseOwner: null }, { leaseUntil: { $lt: now } }],
        };
        const rows: unknown = await strapi.db
          .query(jobUid)
          .findMany({ where: due, orderBy: { id: 'asc' }, limit: JOB_HISTORY_PAGE_SIZE });
        for (const row of z.array(z.unknown()).parse(rows)) {
          const job = decode(row);
          if (!(await takeLease(`document:${job.key}`, owner, now, until))) continue;
          const update: unknown = await strapi.db.query(jobUid).updateMany({
            where: { id: job.id, ...due },
            data: { leaseOwner: owner, leaseUntil: until, status: 'running' },
          });
          if (countSchema.parse(update).count === 1) {
            const interrupted =
              job.status === 'running' && ['translate', 'enqueue'].includes(job.stage);
            return {
              ...job,
              leaseOwner: owner,
              leaseUntil: until,
              status: interrupted ? 'failed' : 'running',
              error: interrupted ? messages.interruptedRequest() : job.error,
            };
          }
          await strapi.db.query(leaseUid).updateMany({
            where: { key: `document:${job.key}`, owner },
            data: { owner: null, expiresAt: null },
          });
        }
        await release(owner);
        return null;
      } catch (failure) {
        await release(owner);
        throw failure;
      }
    },
    async owns(job: StoredJob): Promise<boolean> {
      const now = new Date().toISOString();
      const row: unknown = await strapi.db
        .query(jobUid)
        .findOne({ where: { id: job.id, leaseOwner: job.leaseOwner, leaseUntil: { $gt: now } } });
      return Boolean(job.leaseOwner && row);
    },
    async renew(job: StoredJob): Promise<boolean> {
      const now = new Date().toISOString();
      const until = new Date(Date.now() + JOB_LEASE_MS).toISOString();
      const result: unknown = await strapi.db.query(jobUid).updateMany({
        where: { id: job.id, leaseOwner: job.leaseOwner, leaseUntil: { $gt: now } },
        data: { leaseUntil: until },
      });
      if (countSchema.parse(result).count !== 1) return false;
      const locks: unknown = await strapi.db.query(leaseUid).updateMany({
        where: { owner: job.leaseOwner, expiresAt: { $gt: now } },
        data: { expiresAt: until },
      });
      return countSchema.parse(locks).count === 2;
    },
    async completeStage(job: StoredJob): Promise<boolean> {
      const updated = {
        ...job,
        leaseOwner: null,
        leaseUntil: null,
        updatedAt: new Date().toISOString(),
        status: job.status === 'running' ? 'queued' : job.status,
      };
      const result: unknown = await strapi.db.query(jobUid).updateMany({
        where: {
          id: job.id,
          leaseOwner: job.leaseOwner,
          leaseUntil: { $gt: new Date().toISOString() },
        },
        data: jobColumns(updated),
      });
      if (job.leaseOwner) await release(job.leaseOwner);
      return countSchema.parse(result).count === 1;
    },
    async retry(job: StoredJob): Promise<StoredJob> {
      const next: StoredJob = {
        ...job,
        status: 'queued',
        attempts: 0,
        nextRunAt: new Date().toISOString(),
        error: null,
        leaseOwner: null,
        leaseUntil: null,
      };
      const changed: unknown = await strapi.db.query(jobUid).updateMany({
        where: { id: job.id, status: 'failed', leaseOwner: null },
        data: jobColumns(next),
      });
      if (countSchema.parse(changed).count !== 1)
        return fail('Only failed jobs can be retried; start a new translation for changed content');
      return next;
    },
    async deleteState(
      contentType: string,
      documentId: string,
      locale: string,
      variant?: string
    ): Promise<void> {
      await strapi.db.query(stateUid).deleteMany({
        where: {
          contentType,
          entryDocumentId: documentId,
          locale,
          ...(variant ? { variant } : {}),
        },
      });
    },
  };
};
export type JobRepository = ReturnType<typeof createRepository>;
