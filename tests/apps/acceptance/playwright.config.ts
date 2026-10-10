import { defineConfig, devices } from '@playwright/test';
import { loopbackOrigin } from './src/browser-fixture';
const readerUrl = loopbackOrigin(`http://127.0.0.1:${process.env.READER_PORT ?? '3000'}`);
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: readerUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // Use real Chromium for headless acceptance, matching the browser UI implementation.
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chromium' } }],
  webServer:
    process.env.TESTBED_EXTERNAL_SERVER === 'true'
      ? undefined
      : {
          command: 'node --import tsx ../../../scripts/testbed/demo.ts --isolated',
          url: `${readerUrl}/api/health`,
          reuseExistingServer: false,
          env: { TESTBED_MOCK_CONTROLS: 'true' },
          gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
          timeout: 180_000,
        },
});
