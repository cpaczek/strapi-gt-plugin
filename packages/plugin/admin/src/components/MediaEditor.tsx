import { useState } from 'react';
import { Box, Button, Flex, Typography } from '@strapi/design-system';
import type {
  MediaOverlayItem,
  MediaOverlayRequest,
  MediaOverlayResponse,
} from '../../../shared/contracts';
import { useText } from '../i18n';
import { TextField, Toggle } from './Controls';

interface MediaEditorProps {
  response: MediaOverlayResponse;
  model: string;
  documentId: string;
  locale: string;
  readOnly: boolean;
  busy: boolean;
  onSave: (request: MediaOverlayRequest) => void;
}
const MetadataField = ({
  item,
  model,
  documentId,
  locale,
  readOnly,
  busy,
  onSave,
}: Omit<MediaEditorProps, 'response'> & { item: MediaOverlayItem }) => {
  const text = useText();
  const [value, setValue] = useState(item.value ?? '');
  const [isNull, setNull] = useState(item.value === null);
  const labels = { property: text(`media.${item.property}`), path: item.path.join('.') };
  const save = (reset: boolean) =>
    onSave({
      contentType: model,
      documentId,
      locale,
      path: item.path,
      property: item.property,
      value: isNull ? null : value,
      reset,
    });
  return (
    <Box padding={4} background="neutral100" hasRadius>
      <Flex direction="column" alignItems="stretch" gap={3}>
        <Typography>
          {text('media.source', {
            property: labels.property,
            value: item.source ?? text('common.unset'),
          })}
        </Typography>
        <Typography variant="pi">{text(`media.status.${item.status}`)}</Typography>
        <TextField
          label={text('media.label', labels)}
          value={value}
          disabled={readOnly || busy || isNull}
          onChange={setValue}
        />
        {!readOnly && (
          <>
            <Toggle
              label={text('media.null', labels)}
              checked={isNull}
              disabled={busy}
              onChange={setNull}
            />
            <Flex gap={3} wrap="wrap">
              <Button variant="secondary" disabled={busy} onClick={() => save(false)}>
                {text('media.save', labels)}
              </Button>
              <Button variant="tertiary" disabled={busy} onClick={() => save(true)}>
                {text('media.reset', labels)}
              </Button>
            </Flex>
          </>
        )}
      </Flex>
    </Box>
  );
};
export const MediaEditor = ({ response, ...props }: MediaEditorProps) => {
  const text = useText();
  return (
    <Flex direction="column" alignItems="stretch" gap={4}>
      <Typography textColor="neutral600">{text('media.help')}</Typography>
      <Typography>
        {text(
          !response.draftAndPublish
            ? 'media.immediate'
            : props.readOnly
              ? 'media.published'
              : 'media.draft'
        )}
      </Typography>
      {!response.items.length && <Typography>{text('media.empty')}</Typography>}
      {response.items.map((item) => (
        <MetadataField
          key={JSON.stringify([
            props.locale,
            item.path,
            item.assetId,
            item.property,
            item.value,
            item.status,
          ])}
          item={item}
          {...props}
        />
      ))}
      <Typography variant="pi" textColor="neutral600">
        {text('media.nullHint')}
      </Typography>
    </Flex>
  );
};
