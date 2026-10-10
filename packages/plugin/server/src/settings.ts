import type {
  ContentSchema,
  FieldSchema,
  PluginSettings,
  SettingsResponse,
} from '../../shared/contracts';
import { messages } from '../../shared/messages';
import { DiagnosticError, fail, parseBody, settingsSchema } from './validation';

export type SettingsMetadata = Omit<SettingsResponse, 'settings' | 'hasApiKey' | 'maskedApiKey'>;
const translatedTypes = new Set([
  'string',
  'text',
  'richtext',
  'blocks',
  'component',
  'dynamiczone',
  'uid',
]);

export const fieldAtPath = (
  schema: ContentSchema,
  components: Record<string, ContentSchema>,
  path: string
): FieldSchema | undefined => {
  const parts = path.split('.');
  const head = parts.shift();
  if (!head) return undefined;
  const field = schema.attributes[head];
  if (!field || !parts.length) return field;
  if (field.private || field.localized === false) return undefined;
  if (field.component) {
    const component = components[field.component];
    return component && fieldAtPath(component, components, parts.join('.'));
  }
  if (field.components) {
    const matches = field.components
      .map((uid) => components[uid])
      .filter((component): component is ContentSchema => !!component)
      .map((component) => fieldAtPath(component, components, parts.join('.')));
    return matches.find(Boolean);
  }
  return undefined;
};

export const validateSettings = (input: unknown, metadata: SettingsMetadata): PluginSettings => {
  const settings = parseBody(settingsSchema, input);
  const installed = new Set(metadata.locales.map((locale) => locale.code));
  if (!installed.has(settings.sourceLocale)) fail('Choose an installed source locale');
  if (new Set(settings.targetLocales).size !== settings.targetLocales.length)
    fail('Target locales must be distinct');
  if (settings.targetLocales.includes(settings.sourceLocale))
    fail('The source locale cannot also be a target');
  for (const locale of [settings.sourceLocale, ...settings.targetLocales]) {
    if (!installed.has(locale)) fail('Choose installed target locales');
    const mapped = settings.localeMapping[locale] ?? locale;
    if (!metadata.supportedLocales.includes(mapped))
      throw new DiagnosticError(messages.unsupportedLocale(mapped));
  }
  for (const [locale, mapped] of Object.entries(settings.localeMapping)) {
    if (!installed.has(locale) || !metadata.supportedLocales.includes(mapped))
      throw new DiagnosticError(messages.unsupportedLocale(locale));
  }
  for (const [uid, configured] of Object.entries(settings.contentTypes)) {
    const schema = metadata.contentTypes.find((contentType) => contentType.uid === uid);
    if (!schema?.localized) fail('Choose a localized content type');
    for (const [path, rule] of Object.entries(configured.fields)) {
      const field = fieldAtPath(schema, metadata.components, path);
      if (
        !field ||
        field.private ||
        field.localized === false ||
        (!translatedTypes.has(field.type) && field.type !== 'media')
      )
        fail('Choose a localized text, component, UID or media field');
      if (field.type === 'media' && rule.translate && !configured.mediaMetadata)
        fail('Enable localized media metadata before selecting media fields');
      if (rule.uidStrategy && field.type !== 'uid')
        fail('UID behavior can only be set on a UID field');
      if (rule.uidStrategy === 'regenerate') {
        const sourceName = rule.sourceField ?? field.targetField;
        const sourcePath = [...path.split('.').slice(0, -1), sourceName].filter(Boolean).join('.');
        const source = sourceName
          ? fieldAtPath(schema, metadata.components, sourcePath)
          : undefined;
        if (
          !source ||
          source.private ||
          source.localized === false ||
          !['string', 'text', 'richtext'].includes(source.type)
        )
          fail('Choose a localized text source field for the UID');
      }
    }
  }
  if (metadata.aiTranslationsEnabled && settings.automaticMode !== 'off')
    throw new DiagnosticError(messages.aiConflict());
  return settings;
};

export const publicSettings = (
  settings: PluginSettings,
  metadata: SettingsMetadata,
  key: string | undefined
): SettingsResponse => ({
  settings,
  ...metadata,
  hasApiKey: Boolean(key?.trim()),
  maskedApiKey: key?.trim() ? '********' : '',
});
