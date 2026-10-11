import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createTestDatabase } from '../src/database';

const ownedId = 'a'.repeat(64);
const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  );
});
const fixture = async (scenario: string, runtime = 'docker') => {
  const root = await mkdtemp(resolve(tmpdir(), 'gt-database-lifecycle-'));
  directories.push(root);
  const bin = resolve(root, 'bin');
  await mkdir(bin);
  const records = resolve(root, 'commands.jsonl');
  const script = resolve(bin, runtime);
  await writeFile(
    script,
    `#!/usr/bin/env node
const { appendFileSync, writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');
const args = process.argv.slice(2);
appendFileSync(process.env.FIXTURE_RECORDS, JSON.stringify(args) + '\\n');
const scenario = process.env.FIXTURE_SCENARIO;
if (args[0] === 'run') {
  const envFile = args[args.indexOf('--env-file') + 1];
  if (scenario !== 'missing-receipt') writeFileSync(join(dirname(envFile), 'container.cid'), scenario === 'invalid-receipt' ? 'preexisting-unrelated-container' : '${ownedId}');
  if (scenario.startsWith('run-') || scenario.endsWith('-receipt')) { process.stderr.write('original container run failure'); process.exitCode = 9; }
  else process.stdout.write('${ownedId}');
} else if (args[0] === 'port') {
  process.stdout.write(scenario.startsWith('port-') ? 'invalid port output' : '127.0.0.1:35432');
} else if (args[0] === 'stop' && scenario.endsWith('stop-error')) {
  process.stderr.write('container stop failure'); process.exitCode = 7;
}
`
  );
  await chmod(script, 0o700);
  vi.stubEnv('PATH', `${bin}:${dirname(process.execPath)}:${process.env.PATH ?? ''}`);
  vi.stubEnv('CONTAINER_RUNTIME', runtime);
  vi.stubEnv('FIXTURE_RECORDS', records);
  vi.stubEnv('FIXTURE_SCENARIO', scenario);
  const commands = async () =>
    z.array(z.array(z.string())).parse(
      (await readFile(records, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
    );
  return { root, commands };
};

describe.each(['postgres', 'mysql'])('%s database resource ownership', (client) => {
  it('stops the successfully created container by its receipt ID', async () => {
    const test = await fixture('ok', client === 'mysql' ? 'podman' : 'docker');
    const database = await createTestDatabase(test.root, client);
    expect(database.environment.DATABASE_PORT).toBe('35432');
    await database.close();
    const commands = await test.commands();
    expect(commands[0]).toContain('--cidfile');
    expect(commands.at(-1)).toEqual(['stop', ownedId]);
  });

  it('stops an owned container if run reports failure after creating it', async () => {
    const test = await fixture('run-error');
    await expect(createTestDatabase(test.root, client)).rejects.toThrow(
      'original container run failure'
    );
    expect((await test.commands()).at(-1)).toEqual(['stop', ownedId]);
  });

  it('retains setup failure while stopping the owned container', async () => {
    const test = await fixture('port-error');
    await expect(createTestDatabase(test.root, client)).rejects.toThrow(
      'Container did not expose a loopback database port'
    );
    expect((await test.commands()).at(-1)).toEqual(['stop', ownedId]);
  });

  it.each(['run-and-stop-error', 'port-and-stop-error'])(
    'reports both failures for %s',
    async (scenario) => {
      const test = await fixture(scenario);
      const result = await createTestDatabase(test.root, client).catch(
        (failure: unknown) => failure
      );
      expect(result).toBeInstanceOf(AggregateError);
      if (!(result instanceof AggregateError))
        throw new Error('Setup error was replaced during cleanup');
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0]).toEqual(
        expect.objectContaining({
          message: expect.stringContaining(
            scenario.startsWith('run')
              ? 'original container run failure'
              : 'Container did not expose'
          ),
        })
      );
      expect(result.errors[1]).toEqual(
        expect.objectContaining({ message: expect.stringContaining('container stop failure') })
      );
      expect(result.cause).toBe(result.errors[0]);
      expect((await test.commands()).at(-1)).toEqual(['stop', ownedId]);
    }
  );
});

it.each(['missing-receipt', 'invalid-receipt'])(
  'never stops a guessed container after %s',
  async (scenario) => {
    const test = await fixture(scenario);
    await expect(createTestDatabase(test.root, 'postgres')).rejects.toThrow();
    expect((await test.commands()).map((command) => command[0])).toEqual(['run']);
  }
);
