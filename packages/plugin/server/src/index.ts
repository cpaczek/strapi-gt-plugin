import type { Core } from '@strapi/strapi';
import type { Context } from 'koa';
import { z } from 'zod';
import { GT_BASE_URL, PERMISSIONS, PLUGIN_ID, SETTINGS_ACTION } from '../../shared/constants';
import { messages } from '../../shared/messages';
import { contentTypes } from './content-types';
import { internalOperation } from './documents';
import { createPluginRuntime, type PluginRuntime } from './runtime';
import { DiagnosticError, objectRecord, parseBody, requestSchema, fail } from './validation';
import { classifyFailure } from './worker';

const runtimes = new WeakMap<Core.Strapi, PluginRuntime>();
const runtimeFor = (strapi: Core.Strapi): PluginRuntime => {
  const existing = runtimes.get(strapi);
  if (existing) return existing;
  const runtime = createPluginRuntime(strapi);
  runtimes.set(strapi, runtime);
  return runtime;
};
const actorId = (ctx: Context): number => {
  const state: unknown = ctx.state;
  if (!objectRecord(state) || !objectRecord(state.user) || typeof state.user.id !== 'number')
    throw new DiagnosticError(messages.permissionDenied(), 403);
  return state.user.id;
};
const querySchema = z
  .object({
    contentType: z.string().optional(),
    documentId: z.string().optional(),
    page: z.coerce.number().int().positive().default(1),
  })
  .strict();
const mediaQuery = z
  .object({
    contentType: z.string().min(1),
    documentId: z.string().min(1),
    locale: z.string().min(1),
    status: z.enum(['draft', 'published']).default('draft'),
  })
  .strict();
const mediaBody = z
  .object({
    contentType: z.string().min(1),
    documentId: z.string().min(1),
    locale: z.string().min(1),
    path: z.array(z.union([z.string().min(1), z.number().int().nonnegative()])).min(1),
    property: z.enum(['alternativeText', 'caption']),
    value: z.string().nullable(),
    reset: z.boolean(),
  })
  .strict();
const endpoint =
  (operation: (ctx: Context) => Promise<unknown>) =>
  async (ctx: Context): Promise<void> => {
    try {
      ctx.body = await operation(ctx);
    } catch (failure) {
      const error = classifyFailure(failure).diagnostic;
      ctx.status = failure instanceof DiagnosticError ? failure.status : 500;
      ctx.body = { error };
    }
  };
const controllers = {
  translation: ({ strapi }: { strapi: Core.Strapi }) => ({
    settings: endpoint(async () => runtimeFor(strapi).settings()),
    translationOptions: endpoint(async () => runtimeFor(strapi).translationOptions()),
    saveSettings: endpoint(async (ctx) => {
      const body: unknown = 'body' in ctx.request ? ctx.request.body : undefined;
      return runtimeFor(strapi).saveSettings(body);
    }),
    connection: endpoint(async () => runtimeFor(strapi).connection()),
    translate: endpoint(async (ctx) => {
      const body: unknown = 'body' in ctx.request ? ctx.request.body : undefined;
      return runtimeFor(strapi).enqueue(parseBody(requestSchema, body), actorId(ctx), 'translate');
    }),
    bulk: endpoint(async (ctx) => {
      const body: unknown = 'body' in ctx.request ? ctx.request.body : undefined;
      return runtimeFor(strapi).enqueue(
        parseBody(requestSchema, body),
        actorId(ctx),
        'bulkTranslate'
      );
    }),
    history: endpoint(async (ctx) =>
      runtimeFor(strapi).history(actorId(ctx), parseBody(querySchema, ctx.query))
    ),
    retry: endpoint(async (ctx) =>
      runtimeFor(strapi).retry(
        parseBody(z.coerce.number().int().positive(), ctx.params.id),
        actorId(ctx)
      )
    ),
    media: endpoint(async (ctx) => {
      const query = parseBody(mediaQuery, ctx.query);
      return runtimeFor(strapi).mediaDocument(
        query.contentType,
        query.documentId,
        query.locale,
        query.status,
        actorId(ctx)
      );
    }),
    editMedia: endpoint(async (ctx) => {
      const body: unknown = 'body' in ctx.request ? ctx.request.body : undefined;
      const edit = parseBody(mediaBody, body);
      return runtimeFor(strapi).mediaDocument(
        edit.contentType,
        edit.documentId,
        edit.locale,
        'draft',
        actorId(ctx),
        edit
      );
    }),
  }),
};
const permissionPolicy: Core.PolicyHandler<{ actions?: string[] }> = (ctx, config) => {
  const state: unknown = ctx.state;
  const allowed =
    objectRecord(state) &&
    objectRecord(state.userAbility) &&
    typeof state.userAbility.can === 'function'
      ? state.userAbility.can
      : null;
  if (!allowed || !objectRecord(state) || !objectRecord(state.userAbility)) return false;
  return (config.actions ?? []).some((action) => allowed.call(state.userAbility, action) === true);
};
const route = (
  method: 'GET' | 'PUT' | 'POST',
  path: string,
  action: string,
  permissions: string[]
): Core.RouteInput => ({
  method,
  path,
  handler: `translation.${action}`,
  config: {
    policies: [{ name: `plugin::${PLUGIN_ID}.permission`, config: { actions: permissions } }],
  },
});
const routes = {
  admin: {
    type: 'admin',
    routes: [
      route('GET', '/settings', SETTINGS_ACTION, [PERMISSIONS.readSettings]),
      route('GET', '/translation-options', 'translationOptions', [
        PERMISSIONS.translate,
        PERMISSIONS.bulkTranslate,
      ]),
      route('PUT', '/settings', 'saveSettings', [PERMISSIONS.writeSettings]),
      route('POST', '/connection', 'connection', [PERMISSIONS.readSettings]),
      route('POST', '/translate', 'translate', [PERMISSIONS.translate]),
      route('POST', '/bulk', 'bulk', [PERMISSIONS.bulkTranslate]),
      route('GET', '/jobs', 'history', [
        PERMISSIONS.translate,
        PERMISSIONS.bulkTranslate,
        PERMISSIONS.readSettings,
      ]),
      route('POST', '/jobs/:id/retry', 'retry', [PERMISSIONS.translate, PERMISSIONS.bulkTranslate]),
      route('GET', '/media', 'media', [PERMISSIONS.translate]),
      route('PUT', '/media', 'editMedia', [PERMISSIONS.translate]),
    ],
  } satisfies Core.RouterInput,
};
const config = {
  default: { baseUrl: GT_BASE_URL },
  validator(value: unknown) {
    const parsed = z.object({ baseUrl: z.url() }).strict().safeParse(value);
    if (!parsed.success) return fail('Configure a valid GT base URL on the server');
    const url = new URL(parsed.data.baseUrl);
    if (
      url.username ||
      url.password ||
      (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    )
      fail('Use HTTPS for the GT server URL, or a local test server');
  },
};
const registrationService = (
  value: unknown
): value is {
  actionProvider: {
    registerMany(
      actions: { section: string; displayName: string; uid: string; pluginName: string }[]
    ): Promise<unknown>;
  };
} =>
  objectRecord(value) &&
  objectRecord(value.actionProvider) &&
  typeof value.actionProvider.registerMany === 'function';
const bootstrap = async ({ strapi }: { strapi: Core.Strapi }): Promise<void> => {
  const permissions: unknown = strapi.service('admin::permission');
  if (!registrationService(permissions))
    return fail(
      'Strapi permission registration is unavailable; check the supported Strapi version'
    );
  await permissions.actionProvider.registerMany([
    {
      section: 'plugins',
      displayName: 'Read settings',
      uid: 'read-settings',
      pluginName: PLUGIN_ID,
    },
    {
      section: 'plugins',
      displayName: 'Change settings',
      uid: 'write-settings',
      pluginName: PLUGIN_ID,
    },
    {
      section: 'plugins',
      displayName: 'Translate an entry',
      uid: 'translate',
      pluginName: PLUGIN_ID,
    },
    {
      section: 'plugins',
      displayName: 'Translate entries in bulk',
      uid: 'bulk-translate',
      pluginName: PLUGIN_ID,
    },
  ]);
  runtimeFor(strapi).worker.start();
};
const register = ({ strapi }: { strapi: Core.Strapi }): void => {
  strapi.documents.use(async (context, next) => {
    if (internalOperation.getStore() || !context.uid.startsWith('api::')) return next();
    const runtime = runtimeFor(strapi);
    const settings = await runtime.savedSettings();
    const configured = settings.contentTypes[context.uid];
    if (!configured) return next();
    const { schema, components } = runtime.schemaFor(context.uid, settings);
    const request: unknown = strapi.requestContext.get();
    const state = objectRecord(request) && objectRecord(request.state) ? request.state : {};
    const routeInfo =
      objectRecord(state.route) && objectRecord(state.route.info) ? state.route.info : {};
    if (['findMany', 'findOne', 'findFirst'].includes(context.action)) {
      const result = await next();
      if (
        configured.mediaMetadata &&
        objectRecord(request) &&
        request.method === 'GET' &&
        routeInfo.type === 'content-api'
      ) {
        const decorated = await runtime.media.decorate(result, schema, components, settings);
        if (Array.isArray(result) && Array.isArray(decorated))
          result.forEach((item, index) => {
            const replacement: unknown = decorated[index];
            if (objectRecord(item) && objectRecord(replacement)) Object.assign(item, replacement);
          });
        else if (objectRecord(result) && objectRecord(decorated)) Object.assign(result, decorated);
      }
      return result;
    }
    const result = await strapi.db.transaction(async () => {
      const output = await next();
      const params: unknown = context.params;
      if (
        configured.mediaMetadata &&
        objectRecord(params) &&
        typeof params.documentId === 'string'
      ) {
        const returned: unknown[] =
          objectRecord(output) && Array.isArray(output.entries)
            ? output.entries
            : Array.isArray(output)
              ? output
              : [output];
        const actualLocales = returned.flatMap((entry) =>
          objectRecord(entry) && typeof entry.locale === 'string' ? [entry.locale] : []
        );
        const defaultLocale = await strapi.localization.getDefaultLocale();
        const locales = [
          ...new Set(
            actualLocales.length
              ? actualLocales
              : typeof params.locale === 'string' && params.locale !== '*'
                ? [params.locale]
                : defaultLocale
                  ? [defaultLocale]
                  : []
          ),
        ];
        for (const locale of locales) {
          if (context.action === 'publish') {
            const draft = await runtime.repository.state(
              context.uid,
              params.documentId,
              locale,
              'draft'
            );
            await runtime.repository.saveState(
              context.uid,
              params.documentId,
              locale,
              'published',
              draft
            );
          } else if (context.action === 'discardDraft') {
            const published = await runtime.repository.state(
              context.uid,
              params.documentId,
              locale,
              'published'
            );
            await runtime.repository.saveState(
              context.uid,
              params.documentId,
              locale,
              'draft',
              published
            );
          } else if (context.action === 'unpublish')
            await runtime.repository.deleteState(
              context.uid,
              params.documentId,
              locale,
              'published'
            );
          else if (context.action === 'delete')
            await runtime.repository.deleteState(context.uid, params.documentId, locale);
        }
      }
      return output;
    });
    const automatic =
      settings.automaticMode === 'publish'
        ? context.action === 'publish'
        : settings.automaticMode === 'save' && ['create', 'update'].includes(context.action);
    const user = objectRecord(state.user) ? state.user : {};
    const params: unknown = context.params;
    if (automatic && typeof user.id === 'number' && objectRecord(params)) {
      const rows: unknown[] = Array.isArray(result)
        ? result
        : objectRecord(result) && Array.isArray(result.entries)
          ? result.entries
          : [result];
      const source = rows.find(
        (row) =>
          objectRecord(row) &&
          row.locale === settings.sourceLocale &&
          typeof row.documentId === 'string'
      );
      if (
        objectRecord(source) &&
        typeof source.documentId === 'string' &&
        settings.targetLocales.length
      ) {
        try {
          await runtime.enqueue(
            {
              contentType: context.uid,
              documentIds: [source.documentId],
              targetLocales: settings.targetLocales,
              force: false,
            },
            user.id,
            'translate',
            context.action === 'publish' ? 'published' : 'draft'
          );
        } catch (failure) {
          strapi.log.warn(classifyFailure(failure).diagnostic.text);
        }
      }
    }
    return result;
  });
};
const destroy = async ({ strapi }: { strapi: Core.Strapi }): Promise<void> => {
  const runtime = runtimes.get(strapi);
  if (runtime) await runtime.worker.stop();
  runtimes.delete(strapi);
};

export default {
  register,
  bootstrap,
  destroy,
  config,
  contentTypes,
  controllers,
  routes,
  policies: { permission: permissionPolicy },
  services: { translation: ({ strapi }: { strapi: Core.Strapi }) => runtimeFor(strapi) },
};
