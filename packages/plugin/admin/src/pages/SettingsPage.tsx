import { useState } from 'react';
import type { GtProject } from '../../../shared/contracts';
import { Box, Button, Flex, Main, Typography } from '@strapi/design-system';
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
  const [connection, setConnection] = useState<GtProject>();
  const permissions = useRBAC([
    { action: PERMISSIONS.readSettings },
    { action: PERMISSIONS.writeSettings },
  ]);
  const canRead =
    !permissions.isLoading &&
    !permissions.error &&
    permissions.allowedActions.canReadSettings === true;
  const resource = useResource(canRead ? '/settings' : null, settingsSchema);
  const mutation = useMutation();
  if (permissions.isLoading || !canRead || permissions.error)
    return (
      <Main padding={8}>
        <Typography tag="h1" variant="alpha" id="main-content-title">
          {text('name')}
        </Typography>
        {permissions.isLoading ? <Loading /> : <Notice diagnostic={messages.permissionDenied()} />}
      </Main>
    );
  return (
    <Main padding={8}>
      <Flex direction="column" alignItems="stretch" gap={6}>
        <Flex justifyContent="space-between" gap={4} wrap="wrap">
          <Box>
            <Typography tag="h1" variant="alpha" id="main-content-title">
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
            onClick={() => {
              setConnection(undefined);
              void mutation.run('post', '/connection', {}, connectionSchema, (result) => {
                mutation.setNotice(result.message);
                setConnection(result.project);
              });
            }}
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
        {connection && (
          <Box padding={4} background="neutral0" hasRadius>
            <Flex direction="column" alignItems="stretch" gap={2}>
              <Typography fontWeight="bold">
                {text('settings.connectedProject', { name: connection.name, id: connection.id })}
              </Typography>
              <Typography>
                {text('settings.connectedLocales', {
                  locales: [...new Set([connection.sourceLocale, ...connection.locales])].join(
                    ', '
                  ),
                })}
              </Typography>
            </Flex>
          </Box>
        )}
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
                () => {
                  setConnection(undefined);
                  resource.refresh();
                },
                messages.settingsSaved()
              )
            }
          />
        )}
      </Flex>
    </Main>
  );
};
