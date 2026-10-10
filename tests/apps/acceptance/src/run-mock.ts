import { readFile } from 'node:fs/promises';
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
const server = await startMockGt({ apiKey: settings.mockKey, port: 4100 });
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
