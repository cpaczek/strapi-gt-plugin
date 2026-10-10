import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    coverage: { provider: 'v8', include: ['server/src/**/*.ts', 'shared/**/*.ts'], thresholds: { lines: 90, branches: 90 } },
  },
});
