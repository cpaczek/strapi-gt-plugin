import { Box, Button, Flex, Typography } from '@strapi/design-system';
import { useRBAC } from '@strapi/strapi/admin';
import { PERMISSIONS } from '../../../shared/constants';
import { messages } from '../../../shared/messages';
import { connectionSchema, settingsSchema } from '../api';
import { useMutation, useResource } from '../hooks';
import { useText } from '../i18n';
import { Loading, Notice } from '../components/Controls';
import { SettingsForm } from '../components/SettingsForm';

export const SettingsPage = () => {
  const text = useText();
  const permissions = useRBAC([
    { action: PERMISSIONS.readSettings },
    { action: PERMISSIONS.writeSettings },
  ]);
  const canRead = permissions.allowedActions.canReadSettings === true;
  const resource = useResource(canRead ? '/settings' : null, settingsSchema);
  const mutation = useMutation();
  if (permissions.isLoading) return <Loading />;
  if (!canRead || permissions.error) return <Notice diagnostic={messages.permissionDenied()} />;
  return (
    <Box padding={8}>
      <Flex direction="column" alignItems="stretch" gap={6}>
        <Flex justifyContent="space-between" gap={4} wrap="wrap">
          <Box>
            <Typography tag="h1" variant="alpha">
              {text('name')}
            </Typography>
            <Box paddingTop={2}>
              <Typography textColor="neutral600">{text('settings.subtitle')}</Typography>
            </Box>
          </Box>
          <Button
            variant="secondary"
            disabled={mutation.busy || !resource.result}
            loading={mutation.busy}
            onClick={() =>
              void mutation.run('post', '/connection', {}, connectionSchema, (result) =>
                mutation.setNotice(result.message)
              )
            }
          >
            {text('settings.test')}
          </Button>
        </Flex>
        {resource.error && (
          <>
            <Notice diagnostic={resource.error} />
            <Button variant="secondary" onClick={resource.refresh}>
              {text('common.retry')}
            </Button>
          </>
        )}
        {mutation.notice && <Notice diagnostic={mutation.notice} />}
        {resource.loading && <Loading />}
        {resource.result && (
          <SettingsForm
            key={JSON.stringify(resource.result.settings)}
            response={resource.result}
            canWrite={permissions.allowedActions.canWriteSettings === true}
            saving={mutation.busy}
            onSave={(settings) =>
              void mutation.run(
                'put',
                '/settings',
                settings,
                settingsSchema,
                resource.refresh,
                messages.settingsSaved()
              )
            }
          />
        )}
      </Flex>
    </Box>
  );
};
