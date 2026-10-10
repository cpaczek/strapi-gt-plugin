import type {
  ContentSchema,
  JsonObject,
  PrepareTranslationInput,
  TranslationSegment,
} from '../../shared/contracts';

export const articleSchema: ContentSchema = {
  uid: 'api::article.article',
  localized: true,
  draftAndPublish: true,
  attributes: {
    title: { type: 'string', localized: true },
    body: { type: 'richtext', localized: true },
    blocks: { type: 'blocks', localized: true },
    summary: { type: 'text', localized: true },
    slug: { type: 'uid', targetField: 'title' },
    count: { type: 'integer', localized: true },
    secret: { type: 'string', localized: true, private: true },
    shared: { type: 'string', localized: false },
    related: { type: 'relation', localized: true },
    photo: { type: 'media', localized: true },
    card: { type: 'component', component: 'content.card', localized: true },
    sections: { type: 'dynamiczone', components: ['content.card'], localized: true },
  },
};
export const components: Record<string, ContentSchema> = {
  'content.card': {
    uid: 'content.card',
    localized: false,
    draftAndPublish: false,
    attributes: {
      heading: { type: 'string' },
      count: { type: 'integer' },
      photo: { type: 'media' },
      cards: { type: 'component', component: 'content.card', repeatable: true },
    },
  },
};
export const prepareInput = (
  source: JsonObject,
  extra: Partial<PrepareTranslationInput> = {}
): PrepareTranslationInput => ({
  schema: articleSchema,
  components,
  source,
  target: null,
  rules: {},
  checkpoints: {},
  force: false,
  mediaMetadata: false,
  ...extra,
});
export const identity = (segments: TranslationSegment[]): Record<string, string> =>
  Object.fromEntries(segments.map((segment) => [segment.id, segment.text]));
export const segment = (id = 'title', text = 'Hello', context?: string): TranslationSegment => ({
  id,
  path: [id],
  text,
  kind: 'text',
  ...(context ? { context } : {}),
});
