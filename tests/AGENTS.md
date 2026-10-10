# Acceptance tests

Read the root guide. Use real Strapi and Next.js processes for acceptance. The GT
mock records documented public requests and returns deterministic responses.
A mock success is not a live GT success. Do not skip tests or enable retries.

Wait for observable states rather than elapsed time. Assert negative controls,
permission denial, human-edit protection, draft visibility and persisted restarts.
Only stop processes and containers that this run created. Keep artifacts ignored.
