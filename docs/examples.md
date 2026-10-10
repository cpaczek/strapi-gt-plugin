# Enderman examples

`playground` is the Strapi editor for an original Enderman fan zine. It includes
fan fiction, mock interviews, invented slang, Markdown, Blocks, nested components,
dynamic zones and shared media. `playground-next` reads published articles and
keeps the same document selected when the reader changes language.

The local GT HTTP service produces deterministic marked text. A locale prefix
proves request routing and content delivery; it is not a claim about GT's language
quality. Live quality review requires a real project, a permitted key and a small
separately authorized GT request.

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

| Method                       | Visible example                             |
| ---------------------------- | ------------------------------------------- |
| `formatCurrency`             | Currency symbols, grouping and minor units  |
| `formatNum`                  | Locale-aware number presentation            |
| `formatDateTime`             | Locale and time-zone formatting             |
| `formatRelativeTime`         | A fixed relative interval                   |
| `formatRelativeTimeFromDate` | A date relative to a fixed reference        |
| `formatList`                 | Locale-aware list separators                |
| `formatListToParts`          | List parts with individually rendered items |
| `formatMessage`              | ICU plural and select messages              |
| `formatCutoff`               | Short display text                          |

Locale helpers supply names and text direction; Arabic also exercises RTL layout.
The currency calculator uses an explicitly shown sample rate and ordinary
multiplication. GT formats the resulting number. GT does not fetch exchange rates
or perform currency conversion. See [GT's currency documentation](https://generaltranslation.com/docs/react/reference/components/currency).

The mock-backed browser suite and a live GT language review answer different
questions. Keep both results separate when reporting a demo.
