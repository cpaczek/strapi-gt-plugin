import { useState } from 'react';
import { Box, Button, Flex, Typography } from '@strapi/design-system';
import type {
  ContentTypeSettings,
  FieldRule,
  PluginSettings,
  SettingsResponse,
} from '../../../shared/contracts';
import { messages } from '../../../shared/messages';
import { DEFAULT_CONTENT_TYPE_SETTINGS, DEFAULT_FIELD_RULE } from '../../../shared/constants';
import { selectableFields } from '../fields';
import { useText } from '../i18n';
import { Notice, Section, SelectField, TextField, Toggle } from './Controls';

export interface SettingsFormProps {
  response: SettingsResponse;
  canWrite: boolean;
  saving: boolean;
  onSave: (settings: PluginSettings) => void;
}
export const SettingsForm = ({ response, canWrite, saving, onSave }: SettingsFormProps) => {
  const text = useText();
  const [settings, setSettings] = useState(response.settings);
  const disabled = !canWrite || saving;
  const update = (change: Partial<PluginSettings>) =>
    setSettings((current) => ({ ...current, ...change }));
  const updateType = (uid: string, change: Partial<ContentTypeSettings>) =>
    setSettings((current) => ({
      ...current,
      contentTypes: {
        ...current.contentTypes,
        [uid]: { ...(current.contentTypes[uid] ?? DEFAULT_CONTENT_TYPE_SETTINGS), ...change },
      },
    }));
  const updateField = (uid: string, path: string, change: Partial<FieldRule>, isUid: boolean) => {
    const config = settings.contentTypes[uid] ?? DEFAULT_CONTENT_TYPE_SETTINGS;
    updateType(uid, {
      fields: {
        ...config.fields,
        [path]: {
          ...(config.fields[path] ?? { ...DEFAULT_FIELD_RULE, translate: !isUid }),
          ...change,
        },
      },
    });
  };
  const selectedLocales = [settings.sourceLocale, ...settings.targetLocales];
  const localeOptions = response.locales.map((locale) => ({
    value: locale.code,
    label: `${locale.name} (${locale.code})`,
  }));
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSave(settings);
      }}
    >
      <Flex direction="column" alignItems="stretch" gap={6}>
        {response.aiTranslationsEnabled && <Notice diagnostic={messages.aiConflict()} />}
        <Section title={text('settings.connection')}>
          <TextField
            label={text('settings.project')}
            hint={text('settings.projectHint')}
            value={settings.projectId}
            disabled={disabled}
            onChange={(projectId) => update({ projectId })}
          />
          <Box background="neutral100" padding={4} hasRadius>
            <Flex direction="column" alignItems="stretch" gap={2}>
              <Typography fontWeight="bold">{text('settings.key')}</Typography>
              <Typography tag="code">
                {response.hasApiKey ? response.maskedApiKey : text('settings.keyMissing')}
              </Typography>
              <Typography textColor="neutral600">{text('settings.keyHelp')}</Typography>
            </Flex>
          </Box>
        </Section>
        <Section title={text('settings.locales')} description={text('settings.mappingHint')}>
          <SelectField
            label={text('settings.source')}
            value={settings.sourceLocale}
            options={localeOptions}
            disabled={disabled}
            onChange={(sourceLocale) =>
              update({
                sourceLocale,
                targetLocales: settings.targetLocales.filter((locale) => locale !== sourceLocale),
              })
            }
          />
          <Typography tag="h3" variant="epsilon">
            {text('settings.targets')}
          </Typography>
          <Flex wrap="wrap" gap={5}>
            {response.locales
              .filter((locale) => locale.code !== settings.sourceLocale)
              .map((locale) => (
                <Toggle
                  key={locale.code}
                  label={`${locale.name} (${locale.code})`}
                  disabled={disabled}
                  checked={settings.targetLocales.includes(locale.code)}
                  onChange={(checked) =>
                    update({
                      targetLocales: checked
                        ? [...settings.targetLocales, locale.code]
                        : settings.targetLocales.filter((target) => target !== locale.code),
                    })
                  }
                />
              ))}
          </Flex>
          {selectedLocales.map((locale) => (
            <SelectField
              key={locale}
              label={text('settings.mapping', { locale })}
              value={settings.localeMapping[locale] ?? locale}
              options={response.supportedLocales.map((code) => ({ value: code, label: code }))}
              disabled={disabled}
              onChange={(code) =>
                update({ localeMapping: { ...settings.localeMapping, [locale]: code } })
              }
            />
          ))}
        </Section>
        <Section title={text('settings.fields')} description={text('settings.fieldsHint')}>
          {response.contentTypes.filter((schema) => schema.localized).length === 0 && (
            <Typography>{text('settings.noTypes')}</Typography>
          )}
          {response.contentTypes
            .filter((schema) => schema.localized)
            .map((schema) => {
              const config = settings.contentTypes[schema.uid] ?? DEFAULT_CONTENT_TYPE_SETTINGS;
              const fields = selectableFields(schema, response.components);
              return (
                <Box
                  key={schema.uid}
                  borderColor="neutral200"
                  borderStyle="solid"
                  borderWidth="1px"
                  padding={5}
                  hasRadius
                >
                  <Flex direction="column" alignItems="stretch" gap={5}>
                    <Typography tag="h3" variant="epsilon">
                      {schema.uid}
                    </Typography>
                    {fields.map(({ path, schema: field, parent }) => {
                      const rule = config.fields[path] ?? {
                        ...DEFAULT_FIELD_RULE,
                        translate: field.type !== 'uid',
                      };
                      const parentDisabled =
                        parent
                          ?.split('.')
                          .some(
                            (_part, index, parts) =>
                              config.fields[parts.slice(0, index + 1).join('.')]?.translate ===
                              false
                          ) ?? false;
                      return (
                        <Box key={path} paddingLeft={parent ? 4 : 0}>
                          <Flex direction="column" alignItems="stretch" gap={3}>
                            <Toggle
                              label={text('settings.translateField', { path })}
                              checked={rule.translate}
                              disabled={disabled || parentDisabled}
                              onChange={(translate) =>
                                updateField(schema.uid, path, { translate }, field.type === 'uid')
                              }
                            />
                            <TextField
                              label={text('settings.context', { path })}
                              value={rule.context ?? ''}
                              disabled={disabled || !rule.translate || parentDisabled}
                              onChange={(context) =>
                                updateField(schema.uid, path, { context }, field.type === 'uid')
                              }
                            />
                            {field.type === 'uid' && (
                              <>
                                <SelectField
                                  label={text('settings.uidPolicy', { path })}
                                  value={rule.uidStrategy ?? 'copy'}
                                  options={[
                                    { value: 'copy', label: text('settings.uidCopy') },
                                    { value: 'regenerate', label: text('settings.uidRegenerate') },
                                  ]}
                                  disabled={disabled || !rule.translate}
                                  onChange={(uidStrategy) => {
                                    if (uidStrategy === 'copy' || uidStrategy === 'regenerate')
                                      updateField(schema.uid, path, { uidStrategy }, true);
                                  }}
                                />
                                <TextField
                                  label={text('settings.uidSource', { path })}
                                  value={rule.sourceField ?? field.targetField ?? ''}
                                  disabled={
                                    disabled || !rule.translate || rule.uidStrategy !== 'regenerate'
                                  }
                                  onChange={(sourceField) =>
                                    updateField(schema.uid, path, { sourceField }, true)
                                  }
                                />
                              </>
                            )}
                          </Flex>
                        </Box>
                      );
                    })}
                    <Toggle
                      label={text('settings.media', { model: schema.uid })}
                      checked={config.mediaMetadata}
                      disabled={disabled}
                      onChange={(mediaMetadata) => updateType(schema.uid, { mediaMetadata })}
                    />
                    <Typography textColor="neutral600">{text('settings.mediaHint')}</Typography>
                  </Flex>
                </Box>
              );
            })}
        </Section>
        <Section title={text('settings.delivery')} description={text('settings.deliveryHint')}>
          <Toggle
            label={text('settings.create')}
            checked={settings.createMissingLocales}
            disabled={disabled}
            onChange={(createMissingLocales) => update({ createMissingLocales })}
          />
          <Toggle
            label={text('settings.autoPublish')}
            checked={settings.autoPublish}
            disabled={disabled}
            onChange={(autoPublish) => update({ autoPublish })}
          />
          <SelectField
            label={text('settings.automatic')}
            value={settings.automaticMode}
            disabled={disabled}
            options={[
              { value: 'off', label: text('settings.off') },
              { value: 'save', label: text('settings.saveMode') },
              { value: 'publish', label: text('settings.publishMode') },
            ]}
            onChange={(automaticMode) => {
              if (
                automaticMode === 'off' ||
                automaticMode === 'save' ||
                automaticMode === 'publish'
              )
                update({ automaticMode });
            }}
          />
          <Typography textColor="neutral600">{text('settings.autoHint')}</Typography>
        </Section>
        {canWrite && (
          <Flex justifyContent="flex-end">
            <Button type="submit" loading={saving} disabled={saving}>
              {text('settings.save')}
            </Button>
          </Flex>
        )}
      </Flex>
    </form>
  );
};
