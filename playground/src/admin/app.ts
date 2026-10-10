import type { StrapiApp } from '@strapi/strapi/admin';

const admin = {
  config: {
    locales: ['es', 'fr', 'ar'],
  },
} satisfies Pick<NonNullable<ConstructorParameters<typeof StrapiApp>[0]>, 'config'>;

export default admin;
