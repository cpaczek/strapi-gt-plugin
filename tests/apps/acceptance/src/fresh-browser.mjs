import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const origin = new URL(process.argv[2]);
assert.equal(origin.protocol, 'http:');
assert.equal(origin.hostname, '127.0.0.1');
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(new URL('/admin', origin).href);
  await page.getByLabel(/^Email/i).waitFor({ state: 'visible' });
  await page.waitForLoadState('load');
  assert.equal(await page.getByLabel(/^Email/i).isVisible(), true);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: 'admin-login.png', fullPage: true });
  process.stdout.write('Packed production admin rendered its login form without page errors.\n');
} finally {
  await browser.close();
}
