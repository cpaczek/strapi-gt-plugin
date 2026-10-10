---
name: changeset
description: 'Review the diff against local main and write an appropriate package changeset.'
---

# Changeset

Read AGENTS.md and docs/writing-style.md. Inspect git diff main...HEAD and any
uncommitted changes. Identify changes to the published plugin's public behavior.
Choose patch for compatible fixes, minor for compatible features, and major for
breaking contracts. Internal examples or tooling alone do not need a release bump.
Write one original Markdown file under .changeset with package name
strapi-plugin-general-translation and the selected bump in its YAML frontmatter.
Explain the user-visible behavior, then run pnpm changeset status and the prose
check. Do not version packages, publish, add a remote or push as part of this skill.
