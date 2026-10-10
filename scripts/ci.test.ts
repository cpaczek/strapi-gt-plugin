import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { isMap, isSeq, parseDocument } from 'yaml';

it('provisions Chromium in the isolated packaging job before browser acceptance', async () => {
  const workflow = parseDocument(await readFile('.github/workflows/ci.yml', 'utf8'));
  const steps = workflow.getIn(['jobs', 'packaging', 'steps']);
  expect(isSeq(steps)).toBe(true);
  if (!isSeq(steps)) throw new Error('Packaging job must have steps');
  const commands = steps.items
    .map((step) => (isMap(step) ? step.get('run') : undefined))
    .filter((command): command is string => typeof command === 'string');
  const install = commands.findIndex((command) =>
    /playwright install --with-deps chromium/.test(command)
  );
  const packaging = commands.findIndex((command) => command === 'pnpm test:packaging');
  expect(install).toBeGreaterThanOrEqual(0);
  expect(packaging).toBeGreaterThan(install);
});
