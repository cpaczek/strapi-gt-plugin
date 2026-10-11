import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { realpath, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { runSafeCommand, sanitizeCommandOutput } from './safe-command.mjs';
import { cleanupTestResources } from './cleanup-resources.mjs';
import { stopOwnedProcessGroup } from './owned-process.mjs';
import { setTimeout as pollDelay } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const { compileStrapi, createStrapi } = require('@strapi/strapi');
const pluginPath = await realpath(
  require.resolve('strapi-plugin-general-translation/strapi-server')
);
assert.ok(!pluginPath.includes('/packages/plugin/'), 'Fresh install resolved the workspace source');
const strapi = createStrapi(await compileStrapi());
/** @type {unknown[]} */
const initializationFailures = [];
const translated = { documentId: '', title: '' };
const accountFile = resolve('browser-account.json');
try {
  await strapi.load();
  assert.ok(strapi.plugin('general-translation'));
  const articles = await strapi
    .documents('api::article.article')
    .findMany({ locale: 'en', status: 'published' });
  assert.equal(articles.length, 3);
  const drafts = await strapi
    .documents('api::article.article')
    .findMany({ locale: 'en', status: 'draft' });
  assert.equal(drafts.length, 4);
  const translation = strapi.plugin('general-translation').service('translation');
  await translation.worker.stop();
  const role = await strapi.db
    .query('admin::role')
    .findOne({ where: { code: 'strapi-super-admin' } });
  assert.equal(typeof role?.id, 'number');
  const password = `${randomBytes(32).toString('hex')}Aa1!`;
  const actor = await strapi.service('admin::user').create({
    firstname: 'Packed',
    lastname: 'Test editor',
    email: `${randomBytes(8).toString('hex')}@example.invalid`,
    password,
    isActive: true,
    roles: [role.id],
  });
  await writeFile(
    accountFile,
    JSON.stringify({ adminEmail: actor.email, adminPassword: password }),
    {
      mode: 0o600,
      flag: 'wx',
    }
  );
  const source = articles.find(
    (article) => article.title !== 'The custody hearing of Dirt Block 47'
  );
  assert.ok(source);
  const queued = await translation.enqueue(
    {
      contentType: 'api::article.article',
      documentIds: [source.documentId],
      targetLocales: ['fr'],
      force: false,
    },
    actor.id,
    'translate',
    'published'
  );
  assert.equal(queued.jobs.length, 1);
  const deadline = Date.now() + 60000;
  const completion = { succeeded: false };
  while (Date.now() < deadline) {
    await translation.worker.execute();
    const job = await translation.repository.get(queued.jobs[0].id);
    assert.ok(job);
    assert.ok(!['failed', 'conflict'].includes(job.status), job.error?.text);
    if (job.status === 'succeeded') {
      completion.succeeded = true;
      break;
    }
    await pollDelay(20);
  }
  assert.ok(completion.succeeded, 'Packed translation did not finish');
  const target = await strapi.documents('api::article.article').findOne({
    documentId: source.documentId,
    locale: 'fr',
    status: 'draft',
    populate: ['createdBy', 'updatedBy'],
  });
  assert.equal(target?.title, `[fr] ${source.title}`);
  assert.equal(target?.createdBy?.id, actor.id);
  assert.equal(target?.updatedBy?.id, actor.id);
  assert.equal(
    await strapi
      .documents('api::article.article')
      .findOne({ documentId: source.documentId, locale: 'fr', status: 'published' }),
    null
  );
  const publication = { observed: false };
  const unsubscribe = strapi.eventHub.on('entry.publish', (payload) => {
    if (
      payload?.uid === 'api::article.article' &&
      payload.entry?.documentId === source.documentId &&
      payload.entry.locale === 'fr'
    )
      publication.observed = true;
    return Promise.resolve();
  });
  try {
    await strapi
      .documents('api::article.article')
      .publish({ documentId: source.documentId, locale: 'fr' });
    const deadline = Date.now() + 30000;
    while (!publication.observed && Date.now() < deadline) await pollDelay(20);
    assert.ok(publication.observed, 'Packed publication event did not finish');
  } finally {
    unsubscribe();
  }
  translated.documentId = source.documentId;
  translated.title = target.title;
  process.stdout.write(
    'Packed plugin translated a French draft with editor attribution and then published it.\n'
  );
} catch (failure) {
  initializationFailures.push(failure);
}
await cleanupTestResources([() => strapi.destroy()], initializationFailures);

const { spawn } = await import('node:child_process');
const { once } = await import('node:events');
const { createServer } = await import('node:net');
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
  output.text = `${output.text}${chunk}`.slice(-2000000);
});
server.stderr.on('data', (chunk) => {
  output.text = `${output.text}${chunk}`.slice(-2000000);
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
  assert.ok(
    readiness.ready,
    `Fresh Strapi start did not become healthy: ${sanitizeCommandOutput(output.text)}`
  );
  const response = await fetch(`http://127.0.0.1:${port}/api/articles?status=published&locale=en`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.ok(payload && Array.isArray(payload.data));
  assert.equal(payload.data.length, 3);
  assert.ok(payload.data.every((article) => article.publishedAt));
  const localizedResponse = await fetch(
    `http://127.0.0.1:${port}/api/articles/${translated.documentId}?status=published&locale=fr`
  );
  assert.equal(localizedResponse.status, 200);
  assert.equal((await localizedResponse.json()).data.title, translated.title);
  const browserHelper = process.env.TESTBED_BROWSER_HELPER;
  assert.ok(browserHelper, 'Acceptance browser helper was not supplied');
  const browserResult = await runSafeCommand(
    process.execPath,
    [browserHelper, `http://127.0.0.1:${port}`],
    { cwd: process.cwd(), timeout: 60000, maxBuffer: 1000000 }
  );
  process.stdout.write(browserResult.stdout);
  process.stderr.write(browserResult.stderr);
  const parityHelper = process.env.TESTBED_PARITY_HELPER;
  assert.ok(parityHelper, 'Acceptance parity helper was not supplied');
  const parityResult = await runSafeCommand(
    process.execPath,
    [parityHelper, `http://127.0.0.1:${port}`, accountFile],
    { cwd: process.cwd(), timeout: 1200000, maxBuffer: 8000000 }
  );
  process.stdout.write(parityResult.stdout);
  process.stderr.write(parityResult.stderr);
  process.stdout.write(
    'Consumer pnpm start served published source and translated content over HTTP.\n'
  );
} finally {
  const lifecycle = `Packed Strapi pid=${server.pid}, exit=${server.exitCode}, signal=${server.signalCode}`;
  await stopOwnedProcessGroup(server);
  await writeFile(
    resolve('server-output.log'),
    sanitizeCommandOutput(`${lifecycle}\n${output.text}`),
    { mode: 0o600 }
  );
}
