---
name: test
description: 'Run behavior tests for one package, one file, or the whole workspace.'
---

# Test

Read AGENTS.md and relevant test guidance. Run pnpm test for the workspace,
pnpm --filter <package> test for a package, or pnpm --filter <package> exec
vitest run <test-file> for a Vitest file. Repository-tool tests use pnpm test:tooling.
Acceptance uses pnpm test:integration, pnpm test:e2e or pnpm test:packaging.
Do not introduce skipped cases, exclusive tests, test retries or time-based waits.
Report test counts and command failures. Unit success does not replace an actual
application workflow. Keep live GT requests in the separately requested smoke test.
