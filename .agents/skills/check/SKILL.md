---
name: check
description: 'Build, typecheck, lint and test a workspace package and report each result.'
---

# Check

Read AGENTS.md and the package guide. For a selected package run its build,
typecheck, lint and test scripts with pnpm --filter <package>. Also run node
scripts/check-defaults.mjs, node scripts/check-prose.mjs and pnpm format at the root.
If no package is selected, use the root build, typecheck, lint, test and format
commands. Record each result, including checks that could not run after a failed
build. Finish with a pass/fail table and exact next steps for remaining failures.
Do not describe an unexecuted check as passing.
