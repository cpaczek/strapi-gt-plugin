import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { realpath } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { compileStrapi, createStrapi } = require('@strapi/strapi');
const pluginPath = await realpath(
  require.resolve('strapi-plugin-general-translation/strapi-server')
);
assert.ok(!pluginPath.includes('/packages/plugin/'), 'Fresh install resolved the workspace source');
const strapi = await createStrapi(await compileStrapi()).load();
try {
  assert.ok(strapi.plugin('general-translation'));
  const articles = await strapi
    .documents('api::article.article')
    .findMany({ locale: 'en', status: 'published' });
  assert.equal(articles.length, 3);
  const drafts = await strapi
    .documents('api::article.article')
    .findMany({ locale: 'en', status: 'draft' });
  assert.equal(drafts.length, 4);
  process.stdout.write(
    'Packed plugin loaded in the official scaffold; publication controls passed.\n'
  );
} finally {
  await strapi.destroy();
}

const { spawn } = await import('node:child_process');
const { once } = await import('node:events');
const { createServer } = await import('node:net');
const { setTimeout: pollDelay } = await import('node:timers/promises');
const reservation = createServer();
reservation.listen(0, '127.0.0.1');
await once(reservation, 'listening');
const address = reservation.address();
assert.ok(address && typeof address !== 'string');
const port = address.port;
await new Promise((resolve, reject) =>
  reservation.close((error) => (error ? reject(error) : resolve()))
);
const server = spawn('pnpm', ['start'], {
  cwd: process.cwd(),
  env: { ...process.env, NODE_ENV: 'production', PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true,
});
const output = { text: '' };
server.stdout.on('data', (chunk) => {
  output.text = `${output.text}${chunk}`.slice(-32000);
});
server.stderr.on('data', (chunk) => {
  output.text = `${output.text}${chunk}`.slice(-32000);
});
try {
  const deadline = Date.now() + 30000;
  const readiness = { ready: false };
  while (Date.now() < deadline && server.exitCode === null) {
    try {
      readiness.ready = (await fetch(`http://127.0.0.1:${port}/_health`)).ok;
    } catch (failure) {
      if (!(failure instanceof TypeError)) throw failure;
    }
    if (readiness.ready) break;
    await pollDelay(100);
  }
  assert.ok(readiness.ready, `Fresh Strapi start did not become healthy: ${output.text}`);
  const response = await fetch(`http://127.0.0.1:${port}/api/articles?status=published&locale=en`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.ok(payload && Array.isArray(payload.data));
  assert.equal(payload.data.length, 3);
  assert.ok(payload.data.every((article) => article.publishedAt));
  process.stdout.write('Consumer pnpm start served the three published articles over HTTP.\n');
} finally {
  if (server.exitCode === null && server.pid) {
    process.kill(-server.pid, 'SIGTERM');
    await once(server, 'exit');
  }
}
