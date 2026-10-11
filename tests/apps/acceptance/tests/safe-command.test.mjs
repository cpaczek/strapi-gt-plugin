import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { runSafeCommand, sanitizeCommandOutput } from '../../../../scripts/testbed/safe-command.mjs';

const sentinel = 'synthetic-secret-never-display';
const executeFixture = (text, code = 0) =>
  runSafeCommand(
    process.execPath,
    ['--input-type=module', '-e', `process.stdout.write(process.env.FIXTURE_TEXT); process.stderr.write(process.env.FIXTURE_TEXT); process.exit(${code})`],
    { env: { ...process.env, FIXTURE_TEXT: text }, timeout: 5000 }
  );

describe('safe packaging subprocess output', () => {
  it('removes browser authorization from rejected command output without losing the failure', async () => {
    const text = `apiRequestContext.get: read ECONNRESET\nGET /general-translation/jobs\nAuthorization: Bearer ${sentinel}\n1 failed\n`;
    const failure = await executeFixture(text, 17).catch((error) => error);
    expect(failure).toBeInstanceOf(Error);
    const output = inspect(failure, { depth: 10 });
    expect(output).not.toContain(sentinel);
    expect(output).toContain('ECONNRESET');
    expect(output).toContain('/general-translation/jobs');
    expect(output).toContain('17');
    expect(output).toContain('1 failed');
  });

  it('sanitizes successful stdout and stderr too', async () => {
    const result = await executeFixture(`password: ${sentinel}\n2 passed\n`);
    expect(result.stdout).not.toContain(sentinel);
    expect(result.stderr).not.toContain(sentinel);
    expect(result.stdout).toContain('2 passed');
  });

  it('does not change diagnostic text or paths that contain no credentials', async () => {
    const text = 'ECONNRESET GET /general-translation/jobs\ntrace.zip\n57 passed\n';
    expect(await executeFixture(text)).toEqual({ stdout: text, stderr: text });
  });

  it.each([
    ['lowercase bearer', `authorization: bearer ${sentinel}`],
    ['basic authorization', `Authorization: Basic ${sentinel}`],
    ['proxy authorization', `Proxy-Authorization: Custom ${sentinel}`],
    ['cookie', `Cookie: session=${sentinel}; Path=/`],
    ['response cookie', `Set-Cookie: session=${sentinel}; HttpOnly`],
    ['JSON password', JSON.stringify({ adminPassword: sentinel })],
    ['quoted password', `password: '${sentinel} with spaces'`],
    ['API key', `GT_API_KEY=${sentinel}`],
    ['token parameter', `https://example.invalid/jobs?token=${sentinel}&page=2`],
    ['URL credentials', `https://user:${sentinel}@example.invalid/jobs`],
    ['nested inspected error', inspect({ stderr: `Authorization: Bearer ${sentinel}\npassword: ${sentinel}\nGET /jobs` })],
    ['large Unicode output', `${'مرحبا'.repeat(10000)}\nAuthorization: Bearer ${sentinel}\nGET /jobs`],
  ])('redacts %s', (_name, text) => {
    expect(sanitizeCommandOutput(text)).not.toContain(sentinel);
  });

  it('keeps concurrent child output separate', async () => {
    const result = await Promise.all([
      executeFixture(`Authorization: Bearer ${sentinel}\nfirst passed`),
      executeFixture(`password: ${sentinel}\nsecond passed`),
    ]);
    expect(result[0].stdout).toContain('first passed');
    expect(result[0].stdout).not.toContain('second passed');
    expect(result[1].stderr).toContain('second passed');
    expect(inspect(result)).not.toContain(sentinel);
  });

  it('leaves empty output empty', () => {
    expect(sanitizeCommandOutput('')).toBe('');
  });
});
