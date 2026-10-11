import { request, type APIRequestContext } from '@playwright/test';
import { loopbackOrigin } from './browser-fixture';

export const createEditorApi = (origin: string, token: string): Promise<APIRequestContext> =>
  request.newContext({
    baseURL: loopbackOrigin(origin),
    storageState: { cookies: [], origins: [] },
    // The independent Strapi process can cross its idle socket deadline during synchronous work.
    extraHTTPHeaders: { Connection: 'close', Authorization: `Bearer ${token}` },
  });
