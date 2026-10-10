import { useState } from 'react';
import { Box, Button, Flex, Typography } from '@strapi/design-system';
import { UI_POLL_MS } from '../../../shared/constants';
import type { TranslationOptionsResponse } from '../../../shared/contracts';
import { messages } from '../../../shared/messages';
import { jobsSchema, mediaSchema } from '../api';
import { useMutation, useResource } from '../hooks';
import { useText } from '../i18n';
import { Loading, Notice, SelectField } from './Controls';
import { MediaEditor } from './MediaEditor';
import { TranslationWorkspace } from './TranslationWorkspace';

const LocalizedMedia = ({
  model,
  documentId,
  locale,
  published,
}: {
  model: string;
  documentId: string;
  locale: string;
  published: boolean;
}) => {
  const text = useText();
  const query = new URLSearchParams({
    contentType: model,
    documentId,
    locale,
    status: published ? 'published' : 'draft',
  });
  const resource = useResource(`/media?${query}`, mediaSchema);
  const mutation = useMutation();
  return (
    <Flex direction="column" alignItems="stretch" gap={4}>
      {resource.loading && <Loading />}
      {resource.error && (
        <>
          <Notice diagnostic={resource.error} />
          <Button variant="secondary" onClick={resource.refresh}>
            {text('common.retry')}
          </Button>
        </>
      )}
      {mutation.notice && <Notice diagnostic={mutation.notice} />}
      {resource.result && (
        <MediaEditor
          response={resource.result}
          model={model}
          documentId={documentId}
          locale={locale}
          readOnly={published}
          busy={mutation.busy}
          onSave={(request) =>
            void mutation.run(
              'put',
              '/media',
              request,
              mediaSchema,
              resource.refresh,
              messages.mediaSaved()
            )
          }
        />
      )}
    </Flex>
  );
};
export const DocumentPanel = ({
  model,
  documentId,
  options,
  published,
  currentLocale,
}: {
  model: string;
  documentId: string;
  options: TranslationOptionsResponse;
  published: boolean;
  currentLocale?: string;
}) => {
  const text = useText();
  const [showTranslation, setShowTranslation] = useState(false);
  const [showMedia, setShowMedia] = useState(false);
  const [locale, setLocale] = useState(
    currentLocale && options.targetLocales.some((target) => target.code === currentLocale)
      ? currentLocale
      : (options.targetLocales[0]?.code ?? '')
  );
  const query = new URLSearchParams({ contentType: model, documentId });
  const jobs = useResource(`/jobs?${query}`, jobsSchema, UI_POLL_MS);
  return (
    <Flex direction="column" alignItems="stretch" gap={4}>
      {options.aiTranslationsEnabled && <Notice diagnostic={messages.aiConflict()} />}
      <Typography fontWeight="bold">{text('translation.latest')}</Typography>
      {jobs.loading && <Loading />}
      {jobs.error && (
        <>
          <Notice diagnostic={jobs.error} />
          <Button variant="secondary" onClick={jobs.refresh}>
            {text('common.retry')}
          </Button>
        </>
      )}
      <Box aria-live="polite">
        {options.targetLocales.map((target) => {
          const latest = jobs.result?.jobs.find((job) => job.targetLocale === target.code);
          return (
            <Box key={target.code} paddingBottom={3}>
              <Typography fontWeight="bold">{target.name}</Typography>
              <Box paddingTop={1}>
                <Typography textColor="neutral600">
                  {latest ? text(`status.${latest.status}`) : text('translation.none')}
                </Typography>
              </Box>
              {latest?.error && <Typography textColor="danger600">{latest.error.text}</Typography>}
            </Box>
          );
        })}
      </Box>
      <Button
        variant="secondary"
        onClick={() => setShowTranslation((open) => !open)}
        aria-expanded={showTranslation}
      >
        {text('translation.open')}
      </Button>
      {showTranslation && <TranslationWorkspace model={model} documentIds={[documentId]} />}
      <Button
        variant="tertiary"
        onClick={() => setShowMedia((open) => !open)}
        aria-expanded={showMedia}
      >
        {text('media.title')}
      </Button>
      {showMedia && (
        <>
          <SelectField
            label={text('media.locale')}
            value={locale}
            options={options.targetLocales.map((target) => ({
              value: target.code,
              label: `${target.name} (${target.code})`,
            }))}
            onChange={setLocale}
          />
          {locale && (
            <LocalizedMedia
              key={`${documentId}:${locale}:${published}`}
              model={model}
              documentId={documentId}
              locale={locale}
              published={published}
            />
          )}
        </>
      )}
    </Flex>
  );
};
