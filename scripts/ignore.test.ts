import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it.each([
  'playground/.strapi-cloud.json',
  'playground/.strapi-updater.json',
  'playground/.strapi/client/app.js',
  'playground/types/generated/contentTypes.d.ts',
])('keeps generated Strapi metadata untracked: %s', (filename) => {
  const result = spawnSync('git', ['check-ignore', '--no-index', '--quiet', filename]);
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
});

it.each(['playground/config/server.ts', 'playground/src/index.ts'])(
  'keeps example source trackable: %s',
  (filename) => {
    const result = spawnSync('git', ['check-ignore', '--no-index', '--quiet', filename]);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
  }
);
