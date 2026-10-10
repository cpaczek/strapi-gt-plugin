import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['integration/**/*.test.ts'],
    pool: 'forks',
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 240_000,
    retry: 0,
  },
});
