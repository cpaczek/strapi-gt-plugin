import { REQUEST_TIMEOUT_MS } from '../../../../packages/plugin/shared/constants';
import { strapiOrigin } from '../../../lib/strapi';

export const GET = async (): Promise<Response> => {
  try {
    const backend = await fetch(new URL('/_health', strapiOrigin), {
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return new Response(null, { status: backend.status === 204 ? 204 : 503 });
  } catch {
    return new Response(null, { status: 503 });
  }
};
