import type { Core } from '@strapi/strapi';
import { seedEditorialContent } from './seed/seed';
export default {
  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    if (process.env.PLAYGROUND_SEED === 'true') await seedEditorialContent(strapi);
  },
};
