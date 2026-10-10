import { defineConfig, devices } from '@playwright/test';
const readerUrl = `http://127.0.0.1:${process.env.READER_PORT ?? '3000'}`;
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
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node ../../../scripts/testbed/demo.mjs --isolated',
    url: `${readerUrl}/en`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
