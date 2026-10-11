import type { PersistenceHost, RecordQueries } from '../../server/src/persistence';
import { objectRecord } from '../../server/src/validation';
import type { StoredJob } from '../../server/src/validation';
import { DEFAULT_SETTINGS } from '../../shared/constants';

const compare = (value: unknown, filter: unknown): boolean => {
  if (!objectRecord(filter)) return value === filter;
  return Object.entries(filter).every(([operator, expected]) => {
    if (operator === '$in')
      return Array.isArray(expected) && expected.some((item) => String(item) === String(value));
    if (typeof value !== 'string' && typeof value !== 'number') return false;
    if (typeof expected !== typeof value) return false;
    if (operator === '$lt') return String(value) < String(expected);
    if (operator === '$lte') return String(value) <= String(expected);
    if (operator === '$gt') return String(value) > String(expected);
    return false;
  });
};
const matches = (row: Record<string, unknown>, where: unknown): boolean =>
  !objectRecord(where) ||
  Object.entries(where).every(([name, condition]) =>
    name === '$or'
      ? Array.isArray(condition) && condition.some((branch) => matches(row, branch))
      : compare(row[name], condition)
  );
export const persistenceFixture = () => {
  const tables = new Map<string, Record<string, unknown>[]>();
  let sequence = 0;
  const records = (uid: string) => {
    const existing = tables.get(uid);
    if (existing) return existing;
    const created: Record<string, unknown>[] = [];
    tables.set(uid, created);
    return created;
  };
  const query = (uid: string): RecordQueries => ({
    async findOne(parameters) {
      const candidates = records(uid).filter((row) => matches(row, parameters.where));
      if (objectRecord(parameters.orderBy) && parameters.orderBy.id === 'desc')
        candidates.reverse();
      const found = candidates[0];
      return found ? structuredClone(found) : null;
    },
    async findMany(parameters) {
      const found = records(uid).filter((row) => matches(row, parameters.where));
      if (objectRecord(parameters.orderBy)) {
        const direction = parameters.orderBy.id === 'desc' ? -1 : 1;
        found.sort((left, right) => (Number(left.id) - Number(right.id)) * direction);
      }
      const offset = typeof parameters.offset === 'number' ? parameters.offset : 0;
      const limit = typeof parameters.limit === 'number' ? parameters.limit : found.length;
      return structuredClone(found.slice(offset, offset + limit));
    },
    async create(parameters) {
      if (!objectRecord(parameters.data)) throw new Error('Missing fixture record');
      const row: Record<string, unknown> = { ...structuredClone(parameters.data), id: ++sequence };
      if (uid.endsWith('.lease') && records(uid).some((existing) => existing.key === row.key))
        throw new Error('Duplicate fixture lease');
      records(uid).push(row);
      return structuredClone(row);
    },
    async update(parameters) {
      const row = records(uid).find((candidate) => matches(candidate, parameters.where));
      if (!row || !objectRecord(parameters.data)) return null;
      Object.assign(row, structuredClone(parameters.data));
      return structuredClone(row);
    },
    async updateMany(parameters) {
      let count = 0;
      for (const row of records(uid))
        if (matches(row, parameters.where) && objectRecord(parameters.data)) {
          Object.assign(row, structuredClone(parameters.data));
          count += 1;
        }
      return { count };
    },
    async deleteMany(parameters) {
      const removed = records(uid).filter((row) => matches(row, parameters.where));
      tables.set(
        uid,
        records(uid).filter((row) => !matches(row, parameters.where))
      );
      return { count: removed.length };
    },
    async count(parameters) {
      return records(uid).filter((row) => matches(row, parameters.where)).length;
    },
  });
  return { host: { db: { query } } satisfies PersistenceHost, records };
};
export const jobFixture = (overrides: Partial<StoredJob> = {}): StoredJob => ({
  id: 0,
  key: 'article-document-fr',
  contentType: 'api::article.article',
  documentId: 'document',
  sourceLocale: 'en',
  targetLocale: 'fr',
  actorId: 7,
  force: false,
  status: 'queued',
  stage: 'prepare',
  attempts: 0,
  nextRunAt: new Date(0).toISOString(),
  leaseOwner: null,
  leaseUntil: null,
  prepared: null,
  file: null,
  remoteJobIds: [],
  translations: {},
  error: null,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  settings: structuredClone(DEFAULT_SETTINGS),
  sourceStatus: 'draft',
  permission: 'translate',
  ...overrides,
});
