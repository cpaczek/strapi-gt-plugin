# Strapi editorial example

Run `node scripts/testbed/setup-local.mjs` from the workspace root to create local
settings. Then run `pnpm --filter strapi-plugin-general-translation build` and
`pnpm --filter @gt/playground develop`. The local GT mock runs with
`pnpm --filter @gt/acceptance mock` in another terminal.

The first boot seeds a published coastal article and an unpublished control,
English, French and Arabic locales, nested components, Blocks, Markdown, a media
asset and nontext fields. The seed runs once per database. It does not create
translated content. Use the plugin in the admin to translate and publish it.

The example grants public read access to articles and categories. It is local
test content. Review those permissions before using this application elsewhere.

The Next.js reader is in `playground-next`. Its language links keep the Strapi
document identity. A translation draft stays hidden until it is published.
