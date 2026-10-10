# Server changes

Read the root guide. Register admin routes with explicit permission policies.
Document Service calls need separate actor, content, field and locale checks.
Recheck authorization and source/target hashes before applying queued output.
Keep credentials server-only and return sanitized shared diagnostics.

Persist job stages before moving on. Never hold a database transaction open during
a GT request. Use atomic claims and leases; process restarts must resume remote
jobs using the recorded file/version/branch identity. Shutdown releases resources
owned by this plugin. Keep automatic translation off by default.
