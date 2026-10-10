import type { ContentSchema, FieldSchema } from '../../shared/contracts';

export interface SelectableField {
  path: string;
  schema: FieldSchema;
  parent?: string;
}
const selectable = new Set([
  'string',
  'text',
  'richtext',
  'blocks',
  'component',
  'dynamiczone',
  'uid',
]);
export const selectableFields = (
  schema: ContentSchema,
  components: Record<string, ContentSchema>
): SelectableField[] => {
  const rows = new Map<string, SelectableField>();
  const visit = (current: ContentSchema, prefix: string, ancestry: Set<string>) => {
    for (const [name, field] of Object.entries(current.attributes)) {
      if (
        field.private ||
        !selectable.has(field.type) ||
        (prefix ? field.localized === false : field.localized !== true && field.type !== 'uid')
      )
        continue;
      const path = prefix ? `${prefix}.${name}` : name;
      rows.set(path, { path, schema: field, ...(prefix ? { parent: prefix } : {}) });
      const componentIds =
        field.type === 'component' && field.component
          ? [field.component]
          : field.type === 'dynamiczone'
            ? (field.components ?? [])
            : [];
      for (const componentId of componentIds) {
        const component = components[componentId];
        if (component && !ancestry.has(componentId))
          visit(component, path, new Set([...ancestry, componentId]));
      }
    }
  };
  visit(schema, '', new Set([schema.uid]));
  return [...rows.values()];
};
