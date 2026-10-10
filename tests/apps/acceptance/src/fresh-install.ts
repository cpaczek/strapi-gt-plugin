import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';

const execute = promisify(execFile);
const root = resolve(import.meta.dirname, '../../../..');
const packageSchema = z.object({ name: z.string(), version: z.string() }).passthrough();
const run = async (args: string[], cwd: string): Promise<void> => {
  const result = await execute('pnpm', args, {
    cwd,
    maxBuffer: 8_000_000,
    timeout: 600_000,
    env: {
      ...process.env,
      STRAPI_TELEMETRY_DISABLED: 'true',

      NEXT_TELEMETRY_DISABLED: '1',
    },
  });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
};
await mkdir(resolve(root, 'tests/apps/.generated'), { recursive: true });
const directory = await mkdtemp(resolve(root, 'tests/apps/.generated/fresh-'));
const appDirectory = resolve(directory, 'app');
await run(['--filter', 'strapi-plugin-general-translation', 'build'], root);
await run(['--filter', 'strapi-plugin-general-translation', 'verify'], root);
await run(
  ['--filter', 'strapi-plugin-general-translation', 'pack', '--pack-destination', directory],
  root
);
const tarball = (await readdir(directory)).find((name) => name.endsWith('.tgz'));
if (!tarball) throw new Error('Package command did not create a tarball');
await run(
  [
    'dlx',
    'create-strapi@5.57.0',
    appDirectory,
    '--non-interactive',
    '--skip-cloud',
    '--no-run',
    '--no-install',
    '--no-git-init',
    '--no-example',
    '--use-pnpm',
    '--dbclient',
    'sqlite',
  ],
  root
);
for (const path of ['config', 'src', 'public', 'tsconfig.json'])
  await cp(resolve(root, 'playground', path), resolve(appDirectory, path), { recursive: true });
const playgroundManifest = z
  .object({
    dependencies: z.record(z.string(), z.string()),
    devDependencies: z.record(z.string(), z.string()),
  })
  .parse(JSON.parse(await readFile(resolve(root, 'playground/package.json'), 'utf8')));
const appRequire = createRequire(resolve(root, 'playground/package.json'));
const resolveVersions = async (
  dependencies: Record<string, string>
): Promise<Record<string, string>> =>
  Object.fromEntries(
    await Promise.all(
      Object.keys(dependencies)
        .filter((name) => name !== 'strapi-plugin-general-translation')
        .map(async (name) => {
          const manifest = packageSchema.parse(
            JSON.parse(await readFile(appRequire.resolve(`${name}/package.json`), 'utf8'))
          );
          return [name, manifest.version];
        })
    )
  );
await writeFile(
  resolve(appDirectory, 'package.json'),
  `${JSON.stringify({ name: 'fresh-gt-install', version: '0.0.0', private: true, scripts: { build: 'strapi build', start: 'strapi start', smoke: 'node smoke.mjs' }, dependencies: { ...(await resolveVersions(playgroundManifest.dependencies)), 'strapi-plugin-general-translation': `file:${resolve(directory, tarball)}` }, devDependencies: await resolveVersions(playgroundManifest.devDependencies) }, null, 2)}\n`
);
await writeFile(
  resolve(appDirectory, 'pnpm-workspace.yaml'),
  'packages:\n  - .\nallowBuilds:\n  better-sqlite3: true\n  sharp: true\n  esbuild: true\n  "@swc/core": true\n'
);
const secret = () => randomBytes(32).toString('hex');
await writeFile(
  resolve(appDirectory, '.env'),
  [
    `HOST=127.0.0.1`,
    'PORT=0',
    `APP_KEYS=${secret()},${secret()}`,
    `ADMIN_JWT_SECRET=${secret()}`,
    `API_TOKEN_SALT=${secret()}`,
    `TRANSFER_TOKEN_SALT=${secret()}`,
    `ENCRYPTION_KEY=${secret()}`,
    `JWT_SECRET=${secret()}`,
    'DATABASE_CLIENT=sqlite',
    'DATABASE_FILENAME=.tmp/fresh.db',
    'PLAYGROUND_SEED=true',
    'STRAPI_TELEMETRY_DISABLED=true',

    '',
  ].join('\n'),
  { mode: 0o600 }
);
await cp(resolve(root, 'scripts/testbed/fresh-smoke.mjs'), resolve(appDirectory, 'smoke.mjs'));
await run(['install'], appDirectory);
await run(['build'], appDirectory);
await run(['smoke'], appDirectory);
process.stdout.write(`Fresh tarball installation passed: ${appDirectory}\n`);
