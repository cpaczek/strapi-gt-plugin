export interface RecordQueries {
  findOne(parameters: Record<string, unknown>): Promise<unknown>;
  findMany(parameters: Record<string, unknown>): Promise<unknown>;
  create(parameters: Record<string, unknown>): Promise<unknown>;
  update(parameters: Record<string, unknown>): Promise<unknown>;
  updateMany(parameters: Record<string, unknown>): Promise<unknown>;
  deleteMany(parameters: Record<string, unknown>): Promise<unknown>;
  count(parameters: Record<string, unknown>): Promise<unknown>;
}
export interface PersistenceHost {
  db: { query(uid: string): RecordQueries };
}
