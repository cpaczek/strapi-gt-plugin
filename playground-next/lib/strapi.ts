import 'server-only';
import { createContentReader } from './content';

export const contentReader = createContentReader({
  origin: process.env.STRAPI_URL ?? 'http://127.0.0.1:1337',
  token: process.env.STRAPI_API_TOKEN,
});
export const mediaUrl = (path: string): string =>
  new URL(path, process.env.STRAPI_URL ?? 'http://127.0.0.1:1337').href;
