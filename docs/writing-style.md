# Writing style

Start with the action the reader came to take. Installation instructions come
before promotional copy. Name the setting, command, file or result you mean.
Use familiar verbs and explain unfamiliar terms where they first appear.

Use sentence case headings. Keep each paragraph on one point. Lists should hold
steps or items that a reader needs to compare. Stop when the explanation is
complete; do not add a paragraph that repeats it.

Back claims with a test or a source. State a limitation beside the feature it
limits. Do not use broad claims of quality in place of evidence. Avoid strings
of three adjectives and decorative bold text inside sentences.

Use straight quotes and ordinary hyphens. Keep emoji out of headings. The prose
check enforces the vocabulary in scripts/banned-phrases.json across documentation,
comments, UI strings, changesets and commit messages. This is a project style
policy, not a test of who wrote the text.

Errors should explain the failed action, its cause when known, and the next step.
Use the shared diagnostic builder so the UI and logs agree. Never quote a raw
provider response that might contain a credential.

Comments explain a constraint or a non-obvious choice. Remove comments that just
repeat the next statement, mark a change as new, or preserve dead code. Review
loading, empty and failure screens with the same care as the README.

# Checker boundaries

scripts/checks.test.ts contains deliberate negative prose fixtures and is
explicitly excluded from the prose CLI. scripts/banned-phrases.json supplies the
policy itself. tests/fixtures/ is reserved for external or intentionally invalid
fixture content. Do not move product prose into that directory to avoid a check.

The defaults checker inspects runtime scalar literals in plugin source. Canonical
scalar declarations live in shared/constants.ts. Tests, declaration files and
TypeScript literal types describe contracts or examples and are outside that
check. Settings objects also live in the constants module; reviewers check those
boolean and empty-container defaults because such literals have many unrelated
uses.

The admin uses the Strapi Design System spacing scale in JSX padding, margin and
gap attributes. Integer scale tokens from 0 through 12 in those attributes are a
narrow defaults-check exception. This does not exempt retry counts, concurrency,
timeouts, other JSX properties or server code.
