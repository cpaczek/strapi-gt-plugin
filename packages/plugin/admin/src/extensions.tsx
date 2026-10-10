import { useRBAC } from '@strapi/strapi/admin';
import type {
  BulkActionComponent,
  DocumentActionComponent,
  PanelComponent,
} from '@strapi/content-manager/strapi-admin';
import { PERMISSIONS } from '../../shared/constants';
import { optionsSchema } from './api';
import { useResource } from './hooks';
import { useText } from './i18n';
import { DocumentPanel } from './components/DocumentPanel';
import { TranslationWorkspace } from './components/TranslationWorkspace';

export const TranslateAction: DocumentActionComponent = ({ documentId, model }) => {
  const text = useText();
  const permission = useRBAC([{ action: PERMISSIONS.translate }]);
  const allowed =
    !permission.isLoading && !permission.error && permission.allowedActions.canTranslate;
  const resource = useResource(allowed ? '/translation-options' : null, optionsSchema);
  if (
    !allowed ||
    !documentId ||
    !resource.result?.contentTypes.some((schema) => schema.uid === model && schema.localized)
  )
    return null;
  return {
    label: text('translation.action'),
    position: ['panel', 'header'],
    dialog: {
      type: 'modal',
      title: text('translation.title'),
      content: <TranslationWorkspace model={model} documentIds={[documentId]} />,
    },
  };
};
TranslateAction.position = ['panel', 'header'];
export const TranslateBulkAction: BulkActionComponent = ({ documents, model }) => {
  const text = useText();
  const permission = useRBAC([{ action: PERMISSIONS.bulkTranslate }]);
  const allowed =
    !permission.isLoading && !permission.error && permission.allowedActions.canBulkTranslate;
  const resource = useResource(allowed ? '/translation-options' : null, optionsSchema);
  const documentIds = [
    ...new Set(
      documents
        .map((document) => document.documentId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    ),
  ];
  if (
    !allowed ||
    !documentIds.length ||
    !resource.result?.contentTypes.some((schema) => schema.uid === model && schema.localized)
  )
    return null;
  return {
    label: text('translation.bulk'),
    dialog: {
      type: 'modal',
      title: text('translation.bulk'),
      content: <TranslationWorkspace model={model} documentIds={documentIds} bulk />,
    },
  };
};
export const TranslationPanel: PanelComponent = ({ documentId, document, model, activeTab }) => {
  const text = useText();
  const permission = useRBAC([{ action: PERMISSIONS.translate }]);
  const allowed =
    !permission.isLoading && !permission.error && permission.allowedActions.canTranslate;
  const resource = useResource(allowed ? '/translation-options' : null, optionsSchema);
  if (
    !allowed ||
    !documentId ||
    !resource.result?.contentTypes.some((schema) => schema.uid === model && schema.localized)
  )
    return null;
  return {
    title: text('translation.panel'),
    content: (
      <DocumentPanel
        key={`${model}:${documentId}`}
        model={model}
        documentId={documentId}
        options={resource.result}
        published={activeTab === 'published'}
        currentLocale={typeof document?.locale === 'string' ? document.locale : undefined}
      />
    ),
  };
};
