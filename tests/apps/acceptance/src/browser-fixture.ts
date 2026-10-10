import { readFile } from 'node:fs/promises';
import { z } from 'zod';

export const loopbackOrigin = (value: string): string => {
  const url = new URL(value);
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new TypeError('Browser acceptance requires a loopback HTTP origin without credentials');
  return url.origin;
};
export interface TestAccount {
  email: string;
  password: string;
}
export const loadBrowserAccount = async (path: string): Promise<TestAccount> => {
  const account = z
    .object({ adminEmail: z.email(), adminPassword: z.string().min(1) })
    .parse(JSON.parse(await readFile(path, 'utf8')));
  return { email: account.adminEmail, password: account.adminPassword };
};

export const browserChildEnvironment = (
  baseEnvironment: NodeJS.ProcessEnv,
  _inherited: NodeJS.ProcessEnv
): NodeJS.ProcessEnv => ({ ...baseEnvironment });
