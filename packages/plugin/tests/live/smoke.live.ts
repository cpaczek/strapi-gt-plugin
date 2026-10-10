import { loadEnvFile } from 'node:process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { LIVE_SMOKE_TIMEOUT_MS, REQUEST_TIMEOUT_MS } from '../../shared/constants';
import { runLiveSmoke } from './support';

const localEnvironment = resolve(import.meta.dirname, '../../../../.env');
if (existsSync(localEnvironment)) loadEnvFile(localEnvironment);

test(
  'real GT connection, contextual runtime and exact-version file translation',
  async () => {
    const result = await runLiveSmoke(process.env);
    expect(result.runtime.trim().length).toBeGreaterThan(0);
    expect(result.file.trim().length).toBeGreaterThan(0);
  },
  LIVE_SMOKE_TIMEOUT_MS + REQUEST_TIMEOUT_MS * 6
);
