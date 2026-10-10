---
name: add-test-app
description: 'Create a local Strapi test app under tests/apps wired to the plugin.'
---

# Add test app

Read AGENTS.md, tests/AGENTS.md and tests/apps/AGENTS.md. Use the current pinned
create-strapi-app version from pnpm-workspace.yaml; inspect its --help before
running it. Place the new app under tests/apps/<requested-name>. Disable cloud
login and nested Git initialization. For workspace development add the plugin as
a direct workspace dependency and enable it in config/plugins. For packaging
verification install the tarball instead. Run pnpm install in the new app and
verify it boots with the plugin. Keep generated credentials and database files
ignored. Do not add a remote, publish or reuse a production database.
