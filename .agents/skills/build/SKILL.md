---
name: build
description: "Build one workspace package or all packages with the pinned project toolchain."
---

# Build

Read AGENTS.md and the package's nested guide. With a package name, run
pnpm --filter <package> build. Without one, run pnpm build from the Git root.
The plugin build must use strapi-plugin build through its package script.
Do not edit emitted files. If an imported module is missing, add its direct
dependency to the importing package and rerun pnpm install there. Report the
command, result and any remaining build limitation.
