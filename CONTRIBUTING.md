# Contributing

Use Node 24.21.0 and pnpm 12.11.2 from `mise.toml`. Read [AGENTS.md](AGENTS.md),
the nearest nested guide and [the writing style](docs/writing-style.md) before
changing a file. The repository has no configured remote; adding one, pushing,
publishing or submitting to the Strapi Marketplace requires explicit permission.

## Local setup

Create a branch in a worktree under `.worktrees/`, then run `pnpm install` inside
that worktree. The workspace uses a shared pnpm virtual store with hoisting off.
When pnpm needs to recreate `node_modules`, use `pnpm install --force`. Do not set
`CI` for a local install. Put each dependency in the package that imports it.

| Workspace               | Package                             | Purpose                                                         |
| ----------------------- | ----------------------------------- | --------------------------------------------------------------- |
| `packages/plugin`       | `strapi-plugin-general-translation` | Server, translation engine, contracts and Strapi admin          |
| `playground`            | `@gt/playground`                    | Seeded Strapi editor                                            |
| `playground-next`       | `@gt/reader`                        | Published Enderman fan zine and GT formatting playground        |
| `tests/apps/acceptance` | `@gt/acceptance`                    | Recording GT mock, databases, browser and packed-install checks |

The [playground guide](playground/README.md) describes local example setup. It
creates ignored credentials, so do not copy its `.env` into a fixture or commit.
Use [the example verification guide](docs/examples.md) for the content workflow.

## Make a change

1. Understand the behavior in the current implementation, installed public types
   and current official API documentation. Use explorer agents for independent
   questions and record the expected result in ignored `.work/`.
2. Write black-box behavior tests, including a negative control. Run them, confirm
   the intended failure and commit the tests before implementation.
3. Implement the smallest complete change. Keep existing tests green. Record the
   reason before changing a previously agreed behavior test.
4. Add adversarial cases: empty input, nested content, Unicode and RTL, large
   payloads, concurrent work, partial responses and permission boundaries where
   they apply.
5. Verify the real editor and published reader path. A mocked response or unit test
   does not prove database, browser or tarball behavior.

Keep decisions, logs and review findings in `.work/`. Use small Conventional
Commits. Separate independent work into worktrees, install each one, and compare
its final tree with the integration branch before removing it.

## Checks

Run commands from the repository root. Use `pnpm --filter <package>` to limit a
workspace command while developing.

| Command                 | Check                                                         |
| ----------------------- | ------------------------------------------------------------- |
| `pnpm build`            | Dependency-ordered workspace builds, including the Plugin SDK |
| `pnpm typecheck`        | Strict types in each workspace                                |
| `pnpm lint`             | Defaults, prose, root scripts and workspace lint              |
| `pnpm test`             | Tooling and workspace behavior tests                          |
| `pnpm format`           | Formatting without writes                                     |
| `pnpm test:coverage`    | Plugin engine and server coverage                             |
| `pnpm test:integration` | Real Strapi Document Service against the selected database    |
| `pnpm test:e2e`         | Browser workflows with the recording GT service               |
| `pnpm test:packaging`   | Official Strapi scaffold with a packed local plugin           |
| `pnpm verify`           | Plugin SDK package validation                                 |
| `pnpm size`             | Raw admin JavaScript bundle budget                            |

`pnpm lint:fix` and `pnpm format:fix` write fixes. Lefthook formats staged files,
checks prose and checks commit messages. Inspect its changes before committing.
Do not suppress a failing check or edit generated output to pass it.

`scripts/check-readme.mjs` extracts literal shell commands with their source line
numbers. Its optional `--run-versions` flag executes only `node --version` and
`pnpm --version`; it does not execute installation or project scripts. Follow all
README commands separately in a fresh setup and retain the command log before
committing README changes. This split prevents prose fixtures from running shell
code during ordinary tests.

## Implementation boundaries

Use named exports, strict TypeScript, `const` and descriptive names. The root guide
lists the framework-required default exports. Effects synchronize external
systems; use derived values and event handlers for ordinary React behavior.

Put operational defaults in `packages/plugin/shared/constants.ts`. Build every
user-facing error, warning and validation message through
`packages/plugin/shared/messages.ts`. Never append a provider exception to a UI
notification. Do not import package internals or bypass actor, field or locale
permission checks.

A translation change needs controls for unchanged fields, human edits, source
changes while queued, permission revocation and draft visibility. Media metadata
changes also need the shared-asset controls in [the media guide](docs/media.md).

## Coding agents

`AGENTS.md` is the common guide. `.claude/CLAUDE.md` links to it and
`.claude/skills` links to `.agents/skills`. Read nested instructions explicitly
when the client does not show them in its loaded context.

The eight project skills are `build`, `test`, `typecheck`, `lint-fix`, `check`,
`changeset`, `add-test-app` and `implement-feature`. Codex supports explicit
`$skill-name` selection. The project also defines `explorer`, `code-reviewer` and
`docs-reviewer`; review agents declare read-only sandboxes. Verify the effective
sandbox in the active client before treating a review as read-only.

Codex's `PostToolUse` hook requests formatting after supported edits. Open `/hooks`
and review the current definition before trusting it. New or changed hooks are
skipped until trusted; a direct script test does not prove that an edit event
reached the hook. Lefthook is the separate commit-time check. See
[Codex hooks](https://learn.chatgpt.com/docs/hooks) for the current client behavior.

Both client configurations contain GT's hosted MCP URL without credentials.
Authenticate through the client's supported sign-in flow when you need GT tools.
A configured server is not an authenticated connection. Never add a Bearer key to
committed client configuration.

## Versioning and release

Add a Changeset for a user-visible plugin change. Describe the resulting behavior
and choose the appropriate patch, minor or major bump. Local versioning updates the package
manifest and CHANGELOG. The workspace uses the default Changesets changelog
generator; repository links can be added after a remote exists.

The release workflow runs only by manual dispatch on `main`; publishing defaults
to off. Configure the actual repository and npm trusted-publishing relationship
before a maintainer authorizes publication. It uses OIDC and does not require a
stored npm token. Running local versioning or packing an archive is not permission
to publish it.
