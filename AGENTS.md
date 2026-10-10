# Repository guide

This workspace contains a community Strapi translation plugin and local examples.
Read the nearest nested AGENTS.md before changing files, including in Claude Code.

| Path | Purpose |
| --- | --- |
| packages/plugin | Strapi server, translation engine, shared contracts, admin UI |
| playground | Seeded Strapi example |
| playground-next | Next.js reader for published localized articles |
| tests/apps | Fresh-install and database-matrix applications |
| scripts | Repository checks and contributor tools |
| docs | Installation, operations, and writing guidance |

## Commands

Use the Node and pnpm versions in mise.toml. Run pnpm install, then pnpm build,
pnpm typecheck, pnpm lint, pnpm test, and pnpm format. Package commands accept
pnpm --filter <package>. pnpm format:fix and pnpm lint:fix write fixes.

## Changes

Use local worktrees under .worktrees, one branch per workstream. Run pnpm install
inside every worktree. If node_modules must be recreated, use pnpm install --force;
do not set CI for local installs. Dependencies belong to the package importing them.
Never add a remote, push, publish, or submit the plugin without explicit permission.
Keep .work, .env, test output, and build output untracked. Do not edit generated files.

Write a failing behavior test before implementation. Record working decisions and
verification evidence under .work. Preserve control cases and explain changed tests.
Use small Conventional Commits. Before merging, run the affected checks and tests.

## Code

Use strict TypeScript, named exports, const, and descriptive names. Do not use any,
unchecked casts, var, ignored failures, stray console calls, TODO, or FIXME comments.
Prefix intentional unused parameters with _. React effects synchronize external
systems; use event handlers and derived state otherwise. Import defaults from
packages/plugin/shared/constants.ts. Add new defaults there once.

Default export exceptions: Strapi server and admin entrypoints; framework-mandated
Strapi application config and lifecycle exports; Next.js page, layout, loading,
error and not-found modules; tool configuration exports required by their loaders.
Ordinary components, services and translation modules use named exports.

Every user-facing error, warning, or validation message comes from the typed
message builder in shared/messages.ts. Pass structured cause, remedy, fallback,
details and documentation fields. The builder owns punctuation and the prefix.
Do not append raw provider errors. Server and admin share message definitions.
Read docs/writing-style.md before writing prose or UI strings.

## Verification

Check installed public types and current official documentation before using
Strapi or translation APIs. Never import a package internal subpath. Exercise the
real editor workflow and its published Next.js result. Keep secrets out of browser
bundles, fixtures, logs and commits. Review permission denial and human-edit cases.
A passing unit test does not prove browser, database, packaging or hook behavior.
