import { useState } from 'react';
import { Button, Flex, Typography } from '@strapi/design-system';
import type { TranslationOptionsResponse, TranslationRequest } from '../../../shared/contracts';
import { MAX_DOCUMENTS_PER_REQUEST } from '../../../shared/constants';
import { messages } from '../../../shared/messages';
import { useText } from '../i18n';
import { Notice, Toggle } from './Controls';

export interface TranslationComposerProps {
  options: TranslationOptionsResponse;
  model: string;
  documentIds: string[];
  busy: boolean;
  bulk?: boolean;
  onQueue: (request: TranslationRequest) => void;
}
export const TranslationComposer = ({
  options,
  model,
  documentIds,
  busy,
  bulk = false,
  onQueue,
}: TranslationComposerProps) => {
  const text = useText();
  const [targets, setTargets] = useState(options.targetLocales.map((locale) => locale.code));
  const [force, setForce] = useState(false);
  const [consent, setConsent] = useState(false);
  const schema = options.contentTypes.find((contentType) => contentType.uid === model);
  const allowedTargets = targets.filter(
    (target) =>
      target !== options.sourceLocale &&
      options.targetLocales.some((locale) => locale.code === target)
  );
  const ids = [...new Set(documentIds.filter(Boolean))];
  const disabled =
    busy ||
    !options.configured ||
    !schema?.localized ||
    !allowedTargets.length ||
    !ids.length ||
    ids.length > MAX_DOCUMENTS_PER_REQUEST ||
    (force && !consent);
  return (
    <Flex direction="column" alignItems="stretch" gap={4}>
      {options.aiTranslationsEnabled && <Notice diagnostic={messages.aiConflict()} />}
      {!options.configured && <Typography>{text('translation.notConfigured')}</Typography>}
      {!ids.length && <Typography>{text('translation.unsaved')}</Typography>}
      <Typography>{text('translation.source', { locale: options.sourceLocale })}</Typography>
      <Typography>{text('translation.count', { count: ids.length })}</Typography>
      <Flex direction="column" alignItems="stretch" gap={3}>
        {options.targetLocales
          .filter((locale) => locale.code !== options.sourceLocale)
          .map((locale) => (
            <Toggle
              key={locale.code}
              label={`${locale.name} (${locale.code})`}
              checked={allowedTargets.includes(locale.code)}
              disabled={busy}
              onChange={(checked) => {
                setConsent(false);
                setTargets((current) =>
                  checked
                    ? [...current, locale.code]
                    : current.filter((target) => target !== locale.code)
                );
              }}
            />
          ))}
      </Flex>
      {!options.targetLocales.length && <Typography>{text('translation.noTargets')}</Typography>}
      <Typography textColor="neutral600">
        {text(
          !schema?.draftAndPublish
            ? 'translation.immediate'
            : options.autoPublish
              ? 'translation.published'
              : 'translation.draft'
        )}
      </Typography>
      <Typography textColor="neutral600">
        {text(options.createMissingLocales ? 'translation.create' : 'translation.keepMissing')}
      </Typography>
      <Toggle
        label={text('translation.force')}
        checked={force}
        disabled={busy}
        onChange={(next) => {
          setForce(next);
          setConsent(false);
        }}
      />
      {force && (
        <>
          <Notice diagnostic={messages.forceRetranslate()} />
          <Toggle
            label={text('translation.consent')}
            checked={consent}
            disabled={busy}
            onChange={setConsent}
          />
        </>
      )}
      <Typography textColor="neutral600">{text('translation.cost')}</Typography>
      <Button
        disabled={disabled}
        loading={busy}
        onClick={() =>
          onQueue({ contentType: model, documentIds: ids, targetLocales: allowedTargets, force })
        }
      >
        {text(force ? 'translation.force' : bulk ? 'translation.bulk' : 'translation.action')}
      </Button>
    </Flex>
  );
};
