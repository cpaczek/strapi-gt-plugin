import type { Core } from '@strapi/strapi';
const plugins = ({ env }: Core.Config.Shared.ConfigParams) => ({
  'general-translation': {
    enabled: true,
    config: {
      apiKey: env('GT_API_KEY'),
      projectId: env('GT_PROJECT_ID', 'editorial'),
      baseUrl: env('GT_BASE_URL', 'http://127.0.0.1:4100'),
    },
  },
});
export default plugins;
