---
name: implement-feature
description: 'Implement a plugin feature through research, failing tests, edge cases and real-app validation.'
---

# Implement feature

Read the root and nearest AGENTS.md plus docs/writing-style.md. Keep work notes
under ignored .work. Follow five phases and record each outcome:

1. Understand the requested behavior. Use parallel explorer subagents to inspect
   relevant code, public docs and installed declarations. State the expected result.
2. Write black-box gold tests, including negative controls. Run them, confirm the
   intended failure and commit them. Record a justification before changing them.
3. Make the smallest complete implementation that passes those tests and the
   existing suite. Follow shared message, default, permission and type contracts.
4. Add 10-15 adversarial tests for the affected area. Include nesting, empty input,
   Unicode/RTL, large payloads, concurrency, partial failures and permission boundaries.
5. Exercise the behavior in the real Strapi example and its Next.js output where
   relevant. Record commands, screenshots and any remaining limitation.

When parallel implementation is useful, define shared contracts first and give each
worker its own local worktree. Install dependencies in every worktree. Merge and
validate on main, then compare branch trees before removing merged worktrees.
Do not add phase approval gates when the user has already authorized the feature.
