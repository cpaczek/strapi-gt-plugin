import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/live/*.live.ts'], retry: 0 },
});
