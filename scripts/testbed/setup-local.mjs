import { randomBytes } from 'node:crypto';
import { access, mkdir, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.argv[2] ?? resolve(import.meta.dirname, '../..'));
const settingsPath = resolve(root, '.work/testbed/local.json');
const envPath = resolve(root, 'playground/.env');
const exists = async (path) => {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
};
const settingsExist = await exists(settingsPath);
const envExists = await exists(envPath);
if (settingsExist && envExists) {
  process.stdout.write('Local testbed settings already exist.\n');
} else if (settingsExist || envExists) {
  throw new Error(
    'Local setup found existing configuration and kept it unchanged. Move the existing playground environment and testbed local settings aside together before generating a new pair.'
  );
} else {
  await mkdir(resolve(root, '.work/testbed'), { recursive: true });
  await mkdir(resolve(root, 'playground'), { recursive: true });
  const secret = () => randomBytes(32).toString('hex');
  const settings = {
    mockKey: secret(),
    adminEmail: 'editor@example.invalid',
    adminPassword: `${secret()}Aa1!`,
    appKeys: `${secret()},${secret()}`,
    adminJwtSecret: secret(),
    apiTokenSalt: secret(),
    transferTokenSalt: secret(),
    encryptionKey: secret(),
    jwtSecret: secret(),
  };
  const environment = [
    'HOST=127.0.0.1',
    'PORT=1337',
    `APP_KEYS=${settings.appKeys}`,
    `ADMIN_JWT_SECRET=${settings.adminJwtSecret}`,
    `API_TOKEN_SALT=${settings.apiTokenSalt}`,
    `TRANSFER_TOKEN_SALT=${settings.transferTokenSalt}`,
    `ENCRYPTION_KEY=${settings.encryptionKey}`,
    `JWT_SECRET=${settings.jwtSecret}`,
    'DATABASE_CLIENT=sqlite',
    'DATABASE_FILENAME=.tmp/data.db',
    'PLAYGROUND_SEED=true',
    'GT_BASE_URL=http://127.0.0.1:4100',
    'GT_PROJECT_ID=editorial',
    `GT_API_KEY=${settings.mockKey}`,
    'STRAPI_TELEMETRY_DISABLED=true',
    '',
  ];
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, {
    mode: 0o600,
    flag: 'wx',
  });
  try {
    await writeFile(envPath, environment.join('\n'), { mode: 0o600, flag: 'wx' });
  } catch (failure) {
    await unlink(settingsPath);
    throw failure;
  }
  process.stdout.write('Created ignored local testbed settings and playground environment.\n');
}
