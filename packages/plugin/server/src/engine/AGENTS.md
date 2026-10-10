# Translation engine changes

Read the root and server guides. Keep serialization independent of Strapi globals.
Translate only schema-approved localized leaves. Preserve syntax, Blocks marks,
component identity and fields excluded from translation. Do not send relations,
media files or unrelated document values to GT.

Use only public documented GT exports and verify installed types. Hash source and
last machine target separately. Context changes affect request identity. Reject
missing, extra or invalid translation IDs; do not apply partial output silently.
Test Unicode, nesting, exact identity round trips, target edits and stale work.
