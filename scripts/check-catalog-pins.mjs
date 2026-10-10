import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const requiredPeers = ['react', 'react-dom', 'react-router-dom', 'styled-components'];
export const checkStrapiPeerPins = (catalog, dependencies) => {
  if (!catalog || typeof catalog !== 'object' || !dependencies || typeof dependencies !== 'object')
    throw new TypeError(
      'Read the root catalog and playground dependencies before checking peer pins.'
    );
  return requiredPeers.flatMap((name) =>
    typeof catalog[name] === 'string' && dependencies[name] === catalog[name]
      ? []
      : [
          `${name}: the playground must pin the root catalog version as semver text for Strapi's build check`,
        ]
  );
};

const run = () => {
  const workspace = parse(readFileSync(new URL('../pnpm-workspace.yaml', import.meta.url), 'utf8'));
  const manifest = JSON.parse(
    readFileSync(new URL('../playground/package.json', import.meta.url), 'utf8')
  );
  const findings = checkStrapiPeerPins(workspace.catalog, manifest.dependencies);
  if (findings.length) {
    process.stderr.write(`${findings.join('\n')}\n`);
    process.exitCode = 1;
  } else process.stdout.write('Strapi host peer pins match the shared catalog.\n');
};
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run();
