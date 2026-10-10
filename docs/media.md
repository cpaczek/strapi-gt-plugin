# Localized media metadata

Enable "Translate media alt text and captions" for a content type to translate
its selected media metadata. The plugin stores each result against the parent
document, locale, media occurrence and publication state. It never translates a
media binary or changes the shared Media Library record.

## Edit metadata

In the document's Translation panel, choose the metadata locale. Review the source
and localized values, then save the alt text or caption. These controls edit only
that occurrence in that document and locale.

An empty string is an intentional empty value. "Use null" stores a null value.
"Reset" removes the localized override and restores shared source metadata. A
manual edit receives the same overwrite protection as translated content.

With Draft and Publish, edit the draft tab and publish that locale to expose its
metadata to readers. Published metadata is read only in the panel. Without Draft
and Publish, a saved metadata change is immediately visible.

The Media Library still edits shared source metadata. Changing a caption there can
invalidate localized metadata in several documents, even when those documents use
the same asset with different translated captions.

## Delivery

Normal Content API GET reads through Strapi's Document Service receive valid
localized alt text and captions for populated media. The overlay replaces only
metadata properties already present in the response; it does not expand populate,
restore omitted fields or include otherwise inaccessible media.

If the source metadata, asset or surrounding structure no longer matches the
recorded translation, readers receive current shared metadata. The panel reports
"Source changed" so an editor can review and retranslate it. Reading content never
starts a paid replacement translation.

Admin Media Library views, direct database queries, background reads, custom
controllers that bypass the Document Service, GraphQL resolvers and exports are
outside this delivery contract. Check the actual response your frontend consumes.
The Next example uses Strapi's published REST path.

## Verification controls

Changes to this feature need tests for two documents sharing one file, repeated
occurrences of an asset, nested media, component reordering, asset replacement,
source edits, manual target edits, empty and null values, restricted populate and
field selection. Verify draft, publish, discard and unpublish transitions without
changing the global upload row.
