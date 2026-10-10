const hidden = {
  'content-manager': { visible: false },
  'content-type-builder': { visible: false },
};
export const contentTypes = {
  job: {
    schema: {
      kind: 'collectionType',
      collectionName: 'gt_translation_jobs',
      info: { singularName: 'job', pluralName: 'jobs', displayName: 'GT translation job' },
      options: { draftAndPublish: false },
      pluginOptions: hidden,
      attributes: {
        key: { type: 'string', required: true },
        status: { type: 'string', required: true },
        nextRunAt: { type: 'datetime', required: true },
        leaseOwner: { type: 'string' },
        leaseUntil: { type: 'datetime' },
        actorId: { type: 'integer' },
        contentType: { type: 'string', required: true },
        entryDocumentId: { type: 'string', required: true },
        payload: { type: 'json', required: true },
      },
    },
  },
  lease: {
    schema: {
      kind: 'collectionType',
      collectionName: 'gt_translation_leases',
      info: { singularName: 'lease', pluralName: 'leases', displayName: 'GT translation lease' },
      options: { draftAndPublish: false },
      pluginOptions: hidden,
      attributes: {
        key: { type: 'string', required: true, unique: true },
        owner: { type: 'string' },
        expiresAt: { type: 'datetime' },
      },
    },
  },
  state: {
    schema: {
      kind: 'collectionType',
      collectionName: 'gt_translation_states',
      info: { singularName: 'state', pluralName: 'states', displayName: 'GT translation state' },
      options: { draftAndPublish: false },
      pluginOptions: hidden,
      attributes: {
        key: { type: 'string', required: true, unique: true },
        contentType: { type: 'string', required: true },
        entryDocumentId: { type: 'string', required: true },
        locale: { type: 'string', required: true },
        variant: { type: 'string', required: true },
        checkpoints: { type: 'json' },
        media: { type: 'json' },
        appliedJob: { type: 'integer' },
      },
    },
  },
};
