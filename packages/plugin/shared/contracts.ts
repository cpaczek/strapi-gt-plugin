export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
export interface JsonObject {
  [key: string]: JsonValue;
}
export type FieldPath = readonly (string | number)[];
export type FieldKind =
  | 'string'
  | 'text'
  | 'richtext'
  | 'blocks'
  | 'component'
  | 'dynamiczone'
  | 'media'
  | 'uid'
  | 'relation'
  | 'integer'
  | 'biginteger'
  | 'float'
  | 'decimal'
  | 'boolean'
  | 'date'
  | 'time'
  | 'datetime'
  | 'timestamp'
  | 'enumeration'
  | 'json'
  | 'email'
  | 'password';
export interface FieldSchema {
  type: FieldKind;
  localized?: boolean;
  private?: boolean;
  component?: string;
  components?: string[];
  repeatable?: boolean;
  targetField?: string;
  required?: boolean;
}
export interface ContentSchema {
  uid: string;
  attributes: Record<string, FieldSchema>;
  draftAndPublish: boolean;
  localized: boolean;
}
export interface FieldRule {
  translate: boolean;
  context?: string;
  uidStrategy?: 'copy' | 'regenerate';
  sourceField?: string;
}
export interface ContentTypeSettings {
  fields: Record<string, FieldRule>;
  mediaMetadata: boolean;
}
export interface PluginSettings {
  projectId: string;
  sourceLocale: string;
  targetLocales: string[];
  localeMapping: Record<string, string>;
  contentTypes: Record<string, ContentTypeSettings>;
  createMissingLocales: boolean;
  autoPublish: boolean;
  automaticMode: 'off' | 'save' | 'publish';
}
export interface Diagnostic {
  code: string;
  level: 'error' | 'warning' | 'success';
  text: string;
  details: Record<string, string>;
  docs?: string;
}
export interface SettingsResponse {
  settings: PluginSettings;
  hasApiKey: boolean;
  maskedApiKey: string;
  locales: { code: string; name: string }[];
  supportedLocales: string[];
  contentTypes: ContentSchema[];
  components: Record<string, ContentSchema>;
  aiTranslationsEnabled: boolean;
}
export interface TranslationOptionsResponse {
  configured: boolean;
  sourceLocale: string;
  targetLocales: { code: string; name: string }[];
  contentTypes: Pick<ContentSchema, 'uid' | 'localized' | 'draftAndPublish'>[];
  aiTranslationsEnabled: boolean;
  createMissingLocales: boolean;
  autoPublish: boolean;
}
export interface TranslationSegment {
  id: string;
  path: FieldPath;
  text: string;
  context?: string;
  kind: 'text' | 'markdown' | 'media-alt' | 'media-caption';
}
export interface FieldCheckpoint {
  sourceHash: string;
  targetHash: string;
}
export interface PrepareTranslationInput {
  schema: ContentSchema;
  components: Record<string, ContentSchema>;
  source: JsonObject;
  target: JsonObject | null;
  rules: Record<string, FieldRule>;
  checkpoints: Record<string, FieldCheckpoint>;
  force: boolean;
  mediaMetadata: boolean;
}
export interface PreparedTranslation {
  input: PrepareTranslationInput;
  sourceHash: string;
  targetHash: string;
  segments: TranslationSegment[];
  protectedPaths: string[];
  unchangedPaths: string[];
}
export interface MediaTranslation {
  path: FieldPath;
  assetId: string;
  sourceHash: string;
  alternativeText?: string;
  caption?: string;
}
export interface AppliedTranslation {
  patch: JsonObject;
  checkpoints: Record<string, FieldCheckpoint>;
  media: MediaTranslation[];
}
export interface TranslationEngine {
  prepare(input: PrepareTranslationInput): PreparedTranslation;
  apply(prepared: PreparedTranslation, translations: Record<string, string>): AppliedTranslation;
}
export interface ResolvedGtConfig {
  apiKey: string;
  projectId: string;
  baseUrl: string;
}
export interface GtProject {
  id: string;
  name: string;
  sourceLocale: string;
  locales: string[];
}
export interface GtFileReference {
  fileId: string;
  versionId: string;
  branchId: string;
}
export interface GtTranslationRequest {
  sourceLocale: string;
  targetLocale: string;
  segments: TranslationSegment[];
}
export type GtPollResult =
  | { status: 'pending' }
  | { status: 'ready' }
  | { status: 'failed'; message: Diagnostic };
export interface GtClient {
  testConnection(): Promise<GtProject>;
  translate(request: GtTranslationRequest): Promise<Record<string, string>>;
  upload(request: GtTranslationRequest, fileName: string): Promise<GtFileReference>;
  enqueue(
    reference: GtFileReference,
    request: GtTranslationRequest,
    force: boolean
  ): Promise<string[]>;
  poll(reference: GtFileReference, targetLocale: string, jobIds: string[]): Promise<GtPollResult>;
  download(reference: GtFileReference, targetLocale: string): Promise<Record<string, string>>;
}
export type JobStatus = 'queued' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'conflict';
export type JobStage =
  | 'prepare'
  | 'translate'
  | 'upload'
  | 'enqueue'
  | 'poll'
  | 'download'
  | 'apply';
export interface TranslationRequest {
  contentType: string;
  documentIds: string[];
  targetLocales: string[];
  force: boolean;
}
export interface TranslationJob {
  id: number;
  key: string;
  contentType: string;
  documentId: string;
  sourceLocale: string;
  targetLocale: string;
  actorId: number | null;
  force: boolean;
  status: JobStatus;
  stage: JobStage;
  attempts: number;
  nextRunAt: string;
  leaseOwner: string | null;
  leaseUntil: string | null;
  prepared: PreparedTranslation | null;
  file: GtFileReference | null;
  remoteJobIds: string[];
  translations: Record<string, string>;
  error: Diagnostic | null;
  createdAt: string;
  updatedAt: string;
}
export type JobSummary = Pick<
  TranslationJob,
  | 'id'
  | 'contentType'
  | 'documentId'
  | 'sourceLocale'
  | 'targetLocale'
  | 'status'
  | 'stage'
  | 'attempts'
  | 'error'
  | 'createdAt'
  | 'updatedAt'
>;
export interface JobListResponse {
  jobs: JobSummary[];
  total: number;
}
export interface EnqueueResponse {
  jobs: JobSummary[];
}
export interface ConnectionResponse {
  project: GtProject;
  message: Diagnostic;
}
export interface FailureResponse {
  error: Diagnostic;
}

export type MediaProperty = 'alternativeText' | 'caption';
export interface MediaOverlayItem {
  path: FieldPath;
  assetId: string;
  property: MediaProperty;
  source: string | null;
  value: string | null;
  status: 'source' | 'translated' | 'manual' | 'stale';
}
export interface MediaOverlayResponse {
  items: MediaOverlayItem[];
  draftAndPublish: boolean;
}
export interface MediaOverlayRequest {
  contentType: string;
  documentId: string;
  locale: string;
  path: FieldPath;
  property: MediaProperty;
  value: string | null;
  reset: boolean;
}
