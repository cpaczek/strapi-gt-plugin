import { request, type APIRequestContext } from '@playwright/test';
import { loopbackOrigin } from './browser-fixture';

export const createEditorApi = (origin: string, token: string): Promise<APIRequestContext> =>
  request.newContext({
    baseURL: loopbackOrigin(origin),
    storageState: { cookies: [], origins: [] },
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
