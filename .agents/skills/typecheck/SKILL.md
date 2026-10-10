---
name: typecheck
description: 'Check strict TypeScript types for one package or all workspace packages.'
---

# Typecheck

Read the nearest AGENTS.md. Run pnpm --filter <package> typecheck when a package
is specified, otherwise pnpm typecheck. Verify public installed declarations when
an integration type fails. Do not suppress a type error with any or an unchecked
cast. A dependency belongs to the package importing it. Report the command and
whether the entire selected scope passed.
