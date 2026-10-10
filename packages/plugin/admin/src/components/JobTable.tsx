import {
  Button,
  Box,
  Flex,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';
import { useIntl } from 'react-intl';
import type { JobSummary } from '../../../shared/contracts';
import { useText } from '../i18n';

export const JobTable = ({
  jobs,
  onRetry,
  busy,
}: {
  jobs: JobSummary[];
  onRetry?: (id: number) => void;
  busy: boolean;
}) => {
  const text = useText();
  const { formatDate } = useIntl();
  if (!jobs.length)
    return (
      <Box padding={6}>
        <Typography>{text('jobs.empty')}</Typography>
      </Box>
    );
  return (
    <Box overflow="auto">
      <Table colCount={6} rowCount={jobs.length + 1}>
        <Thead>
          <Tr>
            {[
              'jobs.id',
              'jobs.document',
              'common.target',
              'common.status',
              'jobs.details',
              'common.actions',
            ].map((label) => (
              <Th key={label}>
                <Typography fontWeight="bold">
                  {label === 'jobs.id'
                    ? text('jobs.id')
                    : label === 'jobs.document'
                      ? text('jobs.document')
                      : label === 'common.target'
                        ? text('common.target')
                        : label === 'common.status'
                          ? text('common.status')
                          : label === 'jobs.details'
                            ? text('jobs.details')
                            : text('common.actions')}
                </Typography>
              </Th>
            ))}
          </Tr>
        </Thead>
        <Tbody>
          {jobs.map((job) => (
            <Tr key={job.id}>
              <Td>
                <Typography>{job.id}</Typography>
              </Td>
              <Td>
                <Flex direction="column" alignItems="stretch" gap={1}>
                  <Typography>{job.documentId}</Typography>
                  <Typography variant="pi" textColor="neutral600">
                    {job.contentType}
                  </Typography>
                </Flex>
              </Td>
              <Td>
                <Typography>{job.targetLocale}</Typography>
              </Td>
              <Td>
                <Typography
                  fontWeight="bold"
                  textColor={
                    job.status === 'failed' || job.status === 'conflict'
                      ? 'danger600'
                      : job.status === 'succeeded'
                        ? 'success600'
                        : 'neutral800'
                  }
                >
                  {text(`status.${job.status}`)}
                </Typography>
              </Td>
              <Td>
                <Flex direction="column" alignItems="stretch" gap={2}>
                  <Typography>
                    {text('jobs.stage', { stage: text(`stage.${job.stage}`), count: job.attempts })}
                  </Typography>
                  {job.error && <Typography textColor="danger600">{job.error.text}</Typography>}
                  <Typography variant="pi" textColor="neutral600">
                    {formatDate(job.updatedAt, { dateStyle: 'medium', timeStyle: 'short' })}
                  </Typography>
                </Flex>
              </Td>
              <Td>
                {onRetry && (job.status === 'failed' || job.status === 'conflict') && (
                  <Button variant="secondary" disabled={busy} onClick={() => onRetry(job.id)}>
                    {text('jobs.retry', { id: job.id })}
                  </Button>
                )}
              </Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
    </Box>
  );
};
