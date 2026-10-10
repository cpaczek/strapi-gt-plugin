# Translation operations

The plugin keeps jobs and translation history in Strapi's database. Each job covers
one document and target locale. Keep the database when restarting or deploying the
app; no separate queue service is required.

## Before the first job

Set `GT_API_KEY` in the Strapi server environment. Set `GT_PROJECT_ID` there as an
initial default or enter the project ID in General Translation settings. Once
settings are saved, the saved project ID is used. Restart the server after changing
the key. Do not use `STRAPI_ADMIN_` or `NEXT_PUBLIC_` variables for credentials.

Use a GT project with the same source locale as Strapi. File uploads carry that
source locale, so sharing a GT project with another application's different source
locale can change its behavior. Assign project Context Groups and glossaries in
GT's dashboard. Per-field context is configured in Strapi.

"Test connection" checks access to the configured project. It does not prove that
the key can generate every translation. Runtime translation needs
`project:translations:generate`; file work also needs `project:files:write`,
`project:translations:enqueue` and `project:files:read`. Use a project-scoped key
with the required permissions. Organization context administration is separate.

## Drafts and human changes

Jobs read saved source content. Unsaved editor changes are not sent. The plugin
records hashes of selected source fields and the last machine-written target.
Unchanged source fields need no new translation. Existing target text without a
matching machine history is protected, as are later human changes, including a
cleared target value.

Review "Needs review" results in the target locale. "Force retranslate" requires
explicit acknowledgement before replacing human changes. It still cannot apply an
outdated source snapshot or a target changed while the job was running. Start a
new job after reviewing the latest source and target.

Draft and Publish types receive drafts unless automatic publishing is selected and
the initiating editor has publish permission. Types without Draft and Publish
cannot hide the resulting write from readers. Missing locale creation is a
separate opt-in and still requires create permission.

## Automatic jobs

Automatic mode is off by default. "On source save" and "On source publish" operate
only after successful changes to the configured source locale by an authenticated
admin editor. The job keeps that editor's identity and rechecks current content,
field, locale, create and publish permissions before writing.

Content API requests, API tokens, background scripts and application-origin
Document Service calls do not acquire an admin identity and do not trigger this
automation. The plugin's own target writes do not trigger another translation.

## Retries and recovery

Job history shows the current stage and actionable failure. Persisted file IDs,
versions and remote job IDs allow a restart to resume known GT work. Completed
runtime chunks are saved too, so a later rejected batch does not replay confirmed
translations. Retryable rejections and read failures use bounded exponential
backoff and jitter, respecting a longer GT retry delay. Invalid credentials,
unsupported locales and invalid requests need correction before retry.

When a paid runtime or enqueue request has an uncertain outcome, the job stops
for review instead of automatically repeating it. This includes a lost response,
an ambiguous server failure or a worker interruption before the result was saved.
The plugin does not promise exactly-once billing. Check GT activity before
confirming a manual retry; a repeated request or forced retranslation may incur
another charge. Job history requires that acknowledgement for retry.

Settings or permission changes can make a queued job ineligible. Review the
failure, correct the configuration or role, and start a new translation if its
saved settings no longer match.

## Payloads and context

The engine retains Markdown syntax and Blocks structure locally and sends allowed
text segments. Small batches use GT runtime translation. Large context-free
batches use JSON upload, enqueue, polling and exact-version download. Fields with
context remain on the documented runtime path, even when large; context is not
silently removed to switch transports.

The source payload limit and batching thresholds live in
`packages/plugin/shared/constants.ts`. A document exceeding the source limit fails
before submission. Split oversized content or narrow the translated fields.
