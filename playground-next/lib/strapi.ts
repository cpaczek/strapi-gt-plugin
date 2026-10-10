import 'server-only';
import { createContentReader } from './content';
import { STRAPI_BASE_URL } from '../../packages/plugin/shared/constants';

export const strapiOrigin = process.env.STRAPI_URL ?? STRAPI_BASE_URL;
export const contentReader = createContentReader({
  origin: strapiOrigin,
  token: process.env.STRAPI_API_TOKEN,
});
export const mediaUrl = (path: string): string => new URL(path, strapiOrigin).href;
