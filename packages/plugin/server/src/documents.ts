import { AsyncLocalStorage } from 'node:async_hooks';
import type { Core } from '@strapi/strapi';
import type { ContentSchema, JsonObject } from '../../shared/contracts';
import { jsonObject, fail } from './validation';
import { populateSchema, registeredUid } from './strapi-schema';

export const internalOperation = new AsyncLocalStorage<boolean>();
export const createDocuments = (strapi: Core.Strapi) => ({
  async read(
    schema: ContentSchema,
    components: Record<string, ContentSchema>,
    documentId: string,
    locale: string,
    status: 'draft' | 'published'
  ): Promise<JsonObject | null> {
    const uid = schema.uid;
    if (!registeredUid(strapi, uid)) return fail('The content type no longer exists');
    const document: unknown = await internalOperation.run(true, () =>
      strapi
        .documents(uid)
        .findOne({ documentId, locale, status, populate: populateSchema(schema, components) })
    );
    return document === null ? null : jsonObject.parse(document);
  },
  async write(
    schema: ContentSchema,
    documentId: string,
    locale: string,
    patch: JsonObject,
    actorId: number,
    newLocale: boolean
  ): Promise<void> {
    const uid = schema.uid;
    if (!registeredUid(strapi, uid)) return fail('The content type no longer exists');
    await internalOperation.run(true, () =>
      strapi.documents(uid).update({
        documentId,
        locale,
        data: { ...patch, updatedBy: actorId, ...(newLocale ? { createdBy: actorId } : {}) },
      })
    );
  },
  async publish(schema: ContentSchema, documentId: string, locale: string): Promise<void> {
    const uid = schema.uid;
    if (!registeredUid(strapi, uid)) return fail('The content type no longer exists');
    await internalOperation.run(true, () => strapi.documents(uid).publish({ documentId, locale }));
  },
  async transaction<T>(
    schema: ContentSchema,
    documentId: string,
    callback: () => Promise<T>
  ): Promise<T> {
    return strapi.db.transaction(async ({ trx }) => {
      const metadata = strapi.db.metadata.get(schema.uid);
      const attribute = metadata.attributes.documentId;
      const documentColumn =
        attribute && 'columnName' in attribute ? attribute.columnName : undefined;
      if (!documentColumn) return fail('The document identity column is unavailable');
      await trx(metadata.tableName).where(documentColumn, documentId).select('id').forUpdate();
      return callback();
    });
  },
});
