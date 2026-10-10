import type { Core, UID, Modules } from '@strapi/strapi';
import type { ContentSchema, FieldPath, JsonObject } from '../../shared/contracts';
import { schemaSchema, objectRecord, fail } from './validation';

export const registeredUid = (strapi: Core.Strapi, uid: string): uid is UID.ContentType =>
  Object.hasOwn(strapi.contentTypes, uid);
export const readSchema = (uid: string, raw: unknown, component = false): ContentSchema => {
  if (!objectRecord(raw) || !objectRecord(raw.attributes))
    return fail('The content schema is unavailable');
  const attributes: Record<string, unknown> = {};
  for (const [name, attribute] of Object.entries(raw.attributes)) {
    if (!objectRecord(attribute)) continue;
    const pluginOptions = objectRecord(attribute.pluginOptions) ? attribute.pluginOptions : {};
    const i18n = objectRecord(pluginOptions.i18n) ? pluginOptions.i18n : {};
    const candidate = {
      ...attribute,
      localized: component ? undefined : attribute.type === 'uid' || i18n.localized === true,
      private: attribute.private === true,
    };
    const parsed = schemaSchema.shape.attributes.valueType.safeParse(candidate);
    if (parsed.success) attributes[name] = parsed.data;
  }
  const options = objectRecord(raw.options) ? raw.options : {};
  const pluginOptions = objectRecord(raw.pluginOptions) ? raw.pluginOptions : {};
  const i18n = objectRecord(pluginOptions.i18n) ? pluginOptions.i18n : {};
  return schemaSchema.parse({
    uid,
    attributes,
    draftAndPublish: options.draftAndPublish === true,
    localized: component || i18n.localized === true,
  });
};
export const schemas = (strapi: Core.Strapi) => ({
  contentTypes: Object.entries(strapi.contentTypes)
    .filter(([uid]) => uid.startsWith('api::'))
    .map(([uid, schema]) => readSchema(uid, schema)),
  components: Object.fromEntries(
    Object.entries(strapi.components).map(([uid, schema]) => [uid, readSchema(uid, schema, true)])
  ),
});
export const populateSchema = (
  schema: ContentSchema,
  components: Record<string, ContentSchema>,
  ancestors: string[] = []
): Modules.Documents.Params.Populate.ObjectNotation<UID.ContentType> => {
  if (ancestors.includes(schema.uid))
    return fail('Recursive component schemas cannot be translated');
  const populated: Modules.Documents.Params.Populate.ObjectNotation<UID.ContentType> = {};
  for (const [name, field] of Object.entries(schema.attributes)) {
    if (field.private) continue;
    if (field.type === 'media') populated[name] = true;
    if (field.component) {
      const component = components[field.component];
      if (component)
        populated[name] = {
          populate: populateSchema(component, components, [...ancestors, schema.uid]),
        };
    }
    if (field.components)
      populated[name] = {
        on: Object.fromEntries(
          field.components.flatMap((uid) => {
            const component = components[uid];
            return component
              ? [
                  [
                    uid,
                    { populate: populateSchema(component, components, [...ancestors, schema.uid]) },
                  ],
                ]
              : [];
          })
        ),
      };
  }
  if (!schema.uid.includes('.') || schema.uid.startsWith('api::')) {
    populated.createdBy = { fields: ['id'] };
    populated.updatedBy = { fields: ['id'] };
  }
  return populated;
};
export const permissionField = (
  schema: ContentSchema,
  components: Record<string, ContentSchema>,
  document: JsonObject,
  path: FieldPath
): string => {
  const names: string[] = [];
  let currentSchema = schema;
  let current: unknown = document;
  for (const part of path) {
    if (typeof part === 'number') {
      if (Array.isArray(current)) current = current[part];
      continue;
    }
    const field = currentSchema.attributes[part];
    if (!field) break;
    names.push(part);
    if (objectRecord(current)) current = current[part];
    if (field.component) {
      const component = components[field.component];
      if (component) currentSchema = component;
    } else if (field.components) {
      const first = Array.isArray(current) ? current.find(objectRecord) : current;
      const uid = objectRecord(first) ? first.__component : undefined;
      if (typeof uid === 'string' && components[uid]) currentSchema = components[uid];
    } else break;
  }
  return names.join('.');
};
