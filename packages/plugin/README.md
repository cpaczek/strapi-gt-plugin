# General Translation for Strapi

This community plugin translates selected localized Strapi 5 fields through your
General Translation account. Editors queue single or bulk translations, review
per-locale jobs and keep human changes protected unless they explicitly force a
replacement.

The package currently targets Strapi 5.57.x. The source workspace uses Node 24.21.0
and pnpm 12.11.2. It is not published to npm; use an archive built and packed from
the source workspace. Rebuild your Strapi admin after installing the archive.

## Configure

Set `GT_API_KEY` on the Strapi server and restart it. Set `GT_PROJECT_ID` as an
initial project default or enter the project ID in General Translation settings.
The browser receives only key presence and a masked marker. The key is never
stored in plugin settings or accepted through the admin form.

Enable internationalization on the content type and add the required Strapi
locales. In General Translation settings, choose the source, targets, locale
mappings and fields, save, then test the connection. Use a GT project whose source
locale matches Strapi. Assign glossaries and Context Groups in GT; optional field
context belongs in Strapi settings.

The admin interface includes English, Spanish, French and Arabic labels. It follows
the language selected in Strapi.

## Translate

Save the source document, use Translate or the Translation panel, and choose the
target locales. Select rows in a collection list for Translate selected. Review
the job history and target content before publishing. Draft and Publish types get
drafts by default; types without it expose saved translations immediately.

Automatic translation is off by default. Its save and publish modes require an
authenticated admin editor and that editor's current permissions. Content API and
background writes do not trigger it. Creating a missing locale and publishing a
result each require their own configuration and permission.

Source, target, field and locale permissions apply in addition to the plugin's
Read settings, Change settings, Translate an entry and Translate entries in bulk
permissions. Access is checked again before a queued result is written.

## Content and recovery

Localized strings and text are selected by default. Markdown syntax, Blocks marks
and links, components and dynamic zones keep their structure. UIDs can copy the
source or use a translated field. Relations, media binaries and nontext values
are not sent for translation.

Opt-in media alt text and captions are stored per document and locale. The
Translation panel edits those values; Media Library edits still affect the shared
asset. Valid published metadata is included in populated Content API GET responses.
Custom delivery paths must verify their own response behavior.

Human target changes are protected, including existing text without translation
history. Force retranslate requires acknowledgement and cannot bypass stale-source
checks. Large context-free batches use GT's file flow; contextual fields use its
runtime API. Confirmed runtime chunks and known remote references survive server
restarts in the Strapi database. An uncertain paid request stops for review; check
GT activity before confirming a manual retry.

## Costs and security

Usage is billed to your own GT organization. Workflow, input size, context and
number of targets affect cost; forced or repeated requests can add charges. Check
[GT usage rates](https://generaltranslation.com/en-US/pricing/usage) before enabling
automatic work. Connection success does not prove all translation permissions.

Keep credentials out of admin-prefixed or public environment variables, logs and
commits. The plugin sends selected text and configured context to GT. Disable
Strapi's built-in AI Translations before enabling this plugin's automatic mode;
the two writers do not share human-edit protection.

## License

MIT; see the included LICENSE. This is an independent community integration and is
not an official product of, or endorsed by, General Translation or Strapi.
