import { randomBytes } from 'node:crypto';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { startMockGt } from './mock-gt';

const settings = z
  .object({ mockKey: z.string().min(1) })
  .parse(
    JSON.parse(
      await readFile(resolve(import.meta.dirname, '../../../../.work/testbed/local.json'), 'utf8')
    )
  );
const controlToken =
  process.env.TESTBED_MOCK_CONTROLS === 'true' ? randomBytes(32).toString('hex') : undefined;
const server = await startMockGt({ apiKey: settings.mockKey, port: 4100, controlToken });
if (controlToken) {
  const path = resolve(import.meta.dirname, '../../../../.work/testbed/mock-control.json');
  await writeFile(path, JSON.stringify({ url: server.url, token: controlToken }), { mode: 0o600 });
  await chmod(path, 0o600);
}
process.stdout.write(`Local recording GT service: ${server.url}\n`);
const stop = async () => {
  await server.close();
};
process.once('SIGTERM', () => {
  void stop();
});
process.once('SIGINT', () => {
  void stop();
});
