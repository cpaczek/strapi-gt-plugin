import { useState } from 'react';
import { Box, Button, Flex, Typography } from '@strapi/design-system';
import { useRBAC } from '@strapi/strapi/admin';
import { JOB_HISTORY_PAGE_SIZE, PERMISSIONS, UI_POLL_MS } from '../../../shared/constants';
import { messages } from '../../../shared/messages';
import { enqueueSchema, jobsSchema } from '../api';
import { useMutation, useResource } from '../hooks';
import { useText } from '../i18n';
import { Loading, Notice } from '../components/Controls';
import { JobTable } from '../components/JobTable';

export const JobsPage = () => {
  const text = useText();
  const permissions = useRBAC(Object.values(PERMISSIONS).map((action) => ({ action })));
  const allowed = Object.values(permissions.allowedActions).some(Boolean);
  const canTranslate =
    permissions.allowedActions.canTranslate || permissions.allowedActions.canBulkTranslate;
  const [page, setPage] = useState(1);
  const resource = useResource(allowed ? `/jobs?page=${page}` : null, jobsSchema, UI_POLL_MS);
  const mutation = useMutation();
  if (permissions.isLoading) return <Loading />;
  if (!allowed || permissions.error) return <Notice diagnostic={messages.permissionDenied()} />;
  return (
    <Box padding={8}>
      <Flex direction="column" alignItems="stretch" gap={6}>
        <Flex justifyContent="space-between" gap={4}>
          <Box>
            <Typography tag="h1" variant="alpha">
              {text('jobs.title')}
            </Typography>
            <Box paddingTop={2}>
              <Typography textColor="neutral600">{text('jobs.subtitle')}</Typography>
            </Box>
          </Box>
          <Button variant="secondary" onClick={resource.refresh}>
            {text('common.refresh')}
          </Button>
        </Flex>
        {resource.error && <Notice diagnostic={resource.error} />}
        {mutation.notice && <Notice diagnostic={mutation.notice} />}
        {resource.loading && <Loading />}
        {resource.result && (
          <Box background="neutral0" hasRadius shadow="filterShadow">
            <JobTable
              jobs={resource.result.jobs}
              busy={mutation.busy}
              onRetry={
                canTranslate
                  ? (id) =>
                      void mutation.run(
                        'post',
                        `/jobs/${id}/retry`,
                        {},
                        enqueueSchema,
                        resource.refresh
                      )
                  : undefined
              }
            />
            <Flex padding={4} justifyContent="space-between" gap={3} wrap="wrap">
              <Typography>{text('jobs.total', { count: resource.result.total })}</Typography>
              <Flex gap={3}>
                <Button
                  variant="tertiary"
                  disabled={page === 1}
                  onClick={() => setPage((current) => current - 1)}
                >
                  {text('jobs.previous')}
                </Button>
                <Typography>{text('jobs.page', { page })}</Typography>
                <Button
                  variant="tertiary"
                  disabled={page * JOB_HISTORY_PAGE_SIZE >= resource.result.total}
                  onClick={() => setPage((current) => current + 1)}
                >
                  {text('jobs.next')}
                </Button>
              </Flex>
            </Flex>
          </Box>
        )}
      </Flex>
    </Box>
  );
};
