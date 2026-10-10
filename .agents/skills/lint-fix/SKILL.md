---
name: lint-fix
description: 'Apply the repository lint and format fixes to requested source files or packages.'
---

# Lint fix

Read AGENTS.md and docs/writing-style.md. From the Git root run pnpm exec oxlint
--fix <paths> and pnpm exec oxfmt --write <paths> for a scoped request. Without
paths, run pnpm lint:fix and pnpm format:fix. Inspect the resulting diff and run
pnpm lint and pnpm format. Keep semantic changes separate from formatting fixes.
Do not weaken defaults or prose checks to silence an unrelated failure.
