import { describe, expect, it } from 'vitest';
import {
  connectionSchema,
  enqueueSchema,
  jobsSchema,
  mediaSchema,
  optionsSchema,
  requestDiagnostic,
  settingsSchema,
} from '../../admin/src/api';
import { messages } from '../../shared/messages';
import { failedJob, options, settingsResponse } from './fixtures';

describe('admin response boundary', () => {
  it('discards unexpected credential fields in settings', () => {
    expect(
      settingsSchema.parse({ ...settingsResponse, apiKey: 'credential-fixture' })
    ).not.toHaveProperty('apiKey');
  });
  it('rejects a credential in the masked key field', () => {
    expect(
      settingsSchema.safeParse({ ...settingsResponse, maskedApiKey: 'credential-fixture' }).success
    ).toBe(false);
  });
  it('does not retain settings-only metadata in editor options', () => {
    expect(
      optionsSchema.parse({ ...options, projectId: 'secret-project', maskedApiKey: '********' })
    ).toEqual(options);
  });
  it('rejects invalid status strings', () => {
    expect(
      jobsSchema.safeParse({ jobs: [{ ...failedJob, status: 'complete' }], total: 1 }).success
    ).toBe(false);
  });
  it('rejects an invalid date instead of crashing date rendering', () => {
    expect(
      jobsSchema.safeParse({ jobs: [{ ...failedJob, updatedAt: 'not-a-date' }], total: 1 }).success
    ).toBe(false);
  });
  it('rejects a negative total', () => {
    expect(jobsSchema.safeParse({ jobs: [], total: -1 }).success).toBe(false);
  });
  it('validates every job in a multi-locale queue response', () => {
    expect(
      enqueueSchema.safeParse({ jobs: [failedJob, { ...failedJob, id: 'two' }] }).success
    ).toBe(false);
  });
  it('preserves null and empty values in localized media', () => {
    const response = {
      draftAndPublish: true,
      items: [
        {
          path: ['cover', 0],
          assetId: '1',
          property: 'caption',
          source: null,
          value: '',
          status: 'manual',
        },
      ],
    };
    expect(mediaSchema.parse(response)).toEqual(response);
  });
  it('rejects negative media occurrence indexes', () => {
    expect(
      mediaSchema.safeParse({
        draftAndPublish: true,
        items: [
          {
            path: ['cover', -1],
            assetId: '1',
            property: 'caption',
            source: null,
            value: '',
            status: 'manual',
          },
        ],
      }).success
    ).toBe(false);
  });
  it('accepts the typed connection outcome', () => {
    expect(
      connectionSchema.parse({
        project: { id: 'one', name: 'Editorial', sourceLocale: 'en', locales: ['fr'] },
        message: messages.connectionSuccess(),
      }).message.code
    ).toBe('connection-success');
  });
  it('uses the server diagnostic while discarding a raw transport message', () => {
    expect(
      requestDiagnostic({
        message: 'credential-fixture',
        response: { data: { error: messages.invalidKey() } },
      })
    ).toEqual(messages.invalidKey());
  });
  it('never displays an unknown transport body', () => {
    expect(requestDiagnostic(new Error('credential-fixture'))).toEqual(
      messages.adminRequestFailure()
    );
  });
});
