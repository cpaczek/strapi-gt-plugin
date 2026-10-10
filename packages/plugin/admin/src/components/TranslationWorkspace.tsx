import { Button, Flex } from '@strapi/design-system';
import { enqueueSchema, optionsSchema } from '../api';
import { useMutation, useResource } from '../hooks';
import { useText } from '../i18n';
import { messages } from '../../../shared/messages';
import { Loading, Notice } from './Controls';
import { TranslationComposer } from './TranslationComposer';

export const TranslationWorkspace = ({
  model,
  documentIds,
  bulk = false,
}: {
  model: string;
  documentIds: string[];
  bulk?: boolean;
}) => {
  const text = useText();
  const resource = useResource('/translation-options', optionsSchema);
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
        <TranslationComposer
          key={JSON.stringify([model, documentIds, resource.result.targetLocales])}
          options={resource.result}
          model={model}
          documentIds={documentIds}
          busy={mutation.busy}
          bulk={bulk}
          onQueue={(request) =>
            void mutation.run(
              'post',
              bulk ? '/bulk' : '/translate',
              request,
              enqueueSchema,
              (result) => mutation.setNotice(messages.jobsQueued(result.jobs.length))
            )
          }
        />
      )}
    </Flex>
  );
};
