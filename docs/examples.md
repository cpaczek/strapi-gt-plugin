# Enderman examples

`playground` is the Strapi editor for an original Enderman fan zine. It includes
fan fiction, mock interviews, invented slang, Markdown, Blocks, nested components,
dynamic zones and shared media. `playground-next` reads published articles and
keeps the same document selected when the reader changes language.

Mock mode uses a local GT HTTP service that produces deterministic marked text.
A locale prefix proves request routing and content delivery; it is not a claim
about GT's language quality. Live mode uses your GT account for actual translations
and has a separate database.

## Choose a mode

Build the workspace first with `pnpm build`.
Both demo commands run the built applications. Use the individual package
development commands when editing source files.

`pnpm demo` always uses the generated local mock key, project and loopback endpoint.
It removes inherited `GT_*` values and `STRAPI_API_TOKEN` from the reader and mock
service environments. Explicit `TESTBED_*` acceptance controls remain available.

| Command          | Translation service                 | Local addresses                                                         |
| ---------------- | ----------------------------------- | ----------------------------------------------------------------------- |
| `pnpm demo`      | Recording mock; no paid GT requests | Strapi `http://127.0.0.1:1337/admin`, reader `http://127.0.0.1:3000/en` |
| `pnpm demo:live` | Your GT account                     | Strapi `http://127.0.0.1:1537/admin`, reader `http://127.0.0.1:3300/en` |

Use `READER_PORT` to change the mock reader's port. The live ports have separate
`LIVE_STRAPI_PORT` and `LIVE_READER_PORT` overrides. The runner stops its own child
processes when you press Ctrl+C.

## Editor to reader

1. Start the examples using [the playground setup](../playground/README.md).
2. Open General Translation settings. Save the project, source locale, targets and
   field choices, then test the connection.
3. Save a source article and translate it into one configured locale.
4. Confirm the job result, then open the target draft. Check formatting and the
   invented terminology before publishing.
5. Confirm that the draft is absent from the Next reader. Publish the target locale,
   switch language in the reader and check its title, body and media caption.
6. Change the target manually, change the source, and translate again. Confirm the
   human text survives. Review the force acknowledgement before testing replacement.

Run the permission control with a limited editor too: hidden buttons alone do not
prove the server refuses a direct unauthorized request.

## GT formatting playground

The reader demonstrates the public GT formatting methods alongside the CMS
content. These formatting operations run locally and require no translation key.

| Method                       | Visible example                                                                  |
| ---------------------------- | -------------------------------------------------------------------------------- |
| `formatCurrency`             | Currency symbols, grouping and minor units                                       |
| `formatNum`                  | Decimal, percent, compact and meter formats; Latin, Arabic and Devanagari digits |
| `formatDateTime`             | Locale and time-zone formatting                                                  |
| `formatRelativeTime`         | A fixed relative interval                                                        |
| `formatRelativeTimeFromDate` | A date relative to a fixed reference                                             |
| `formatList`                 | Locale-aware list separators                                                     |
| `formatListToParts`          | List parts with individually rendered items                                      |
| `formatMessage`              | ICU plural and select messages                                                   |
| `formatCutoff`               | Short display text                                                               |

Locale helpers supply names and text direction; Arabic also exercises RTL layout.
The currency calculator uses an explicitly shown sample rate and ordinary
multiplication. GT formats the resulting number. GT does not fetch exchange rates
or perform currency conversion. See [GT's currency documentation](https://generaltranslation.com/docs/react/reference/components/currency).

The mock-backed browser suite and a live GT language review answer different
questions. Keep both results separate when reporting a demo.

## Use your GT account

Set `GT_API_KEY` and `GT_PROJECT_ID` in the ignored root `.env`, build the workspace,
then run `pnpm demo:live`. Open Strapi at `http://127.0.0.1:1537/admin` and the reader
at `http://127.0.0.1:3300/en`. This mode uses the real GT API and your account's
translation allowance. Only the Strapi process receives the GT credentials.

The live example has a separate persistent SQLite database under `.work/live-demo`.
It does not alter the mock example's documents. Register a local editor, check the
project and locale mapping in settings, then translate and publish an article.
Per-field context explains the fan zine's slang; glossary terms remain unchanged.
Compare the translated story with its source in the reader.

Use `LIVE_STRAPI_PORT` and `LIVE_READER_PORT` to choose other ports. Stop the command
with Ctrl+C. Saved articles remain available when you start it again.
