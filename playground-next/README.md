# The Ender Post

Start the seeded Strapi application, then run `pnpm --filter @gt/reader dev` from
the workspace root. Open `http://127.0.0.1:3000/en`.

This unofficial Enderman fan zine fetches published articles on the server and renders Blocks, Markdown,
components, media captions and galleries. French and Arabic links preserve the
article's document identity. Unpublished translations show an availability
message. The Arabic edition uses right-to-left layout.

`STRAPI_URL` selects the local content server. `STRAPI_API_TOKEN` is optional and
stays server-side. The seeded example grants public article reads, so no token is
needed for local use. The reader never requests draft content.
