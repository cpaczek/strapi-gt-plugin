import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import { z } from 'zod';

const require = createRequire(import.meta.url);
const designSystemManifest = require.resolve('@strapi/design-system/package.json');
const designSystemRequire = createRequire(designSystemManifest);
const publicModule = (manifestPath: string) => {
  const manifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
  return resolve(dirname(manifestPath), z.object({ module: z.string() }).parse(manifest).module);
};

export default defineConfig({
  resolve: {
    // These packages declare CommonJS main files inside type:module packages.
    // Resolve their published module entry, as the Strapi admin bundler does.
    alias: {
      '@strapi/design-system': publicModule(designSystemManifest),
      '@strapi/ui-primitives': publicModule(
        designSystemRequire.resolve('@strapi/ui-primitives/package.json')
      ),
    },
  },
  test: {
    server: { deps: { inline: [/@strapi\/(design-system|ui-primitives)/] } },
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      include: ['server/src/**/*.ts', 'shared/**/*.ts'],
      thresholds: {
        lines: 90,
        branches: 90,
        'server/src/*.ts': { lines: 90, branches: 90 },
        'server/src/engine/**/*.ts': { lines: 90, branches: 90 },
      },
    },
  },
});
