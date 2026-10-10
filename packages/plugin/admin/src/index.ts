import type { StrapiApp } from '@strapi/strapi/admin';
import type {
  BulkActionComponent,
  DocumentActionComponent,
  PanelComponent,
} from '@strapi/content-manager/strapi-admin';
import { Earth } from '@strapi/icons';
import { PERMISSIONS, PLUGIN_ID } from '../../shared/constants';
import { messages } from '../../shared/messages';
import { TranslateAction, TranslateBulkAction, TranslationPanel } from './extensions';
import { descriptor } from './i18n';
import english from './translations/en.json';

const translations = new Map<string, () => Promise<{ default: typeof english }>>([
  ['es', () => import('./translations/es.json')],
  ['fr', () => import('./translations/fr.json')],
  ['ar', () => import('./translations/ar.json')],
]);

interface ContentManagerApi {
  addDocumentAction: (actions: DocumentActionComponent[]) => void;
  addBulkAction: (actions: BulkActionComponent[]) => void;
  addEditViewSidePanel: (panels: PanelComponent[]) => void;
}
export const isContentManagerApi = (candidate: unknown): candidate is ContentManagerApi =>
  typeof candidate === 'object' &&
  candidate !== null &&
  'addDocumentAction' in candidate &&
  typeof candidate.addDocumentAction === 'function' &&
  'addBulkAction' in candidate &&
  typeof candidate.addBulkAction === 'function' &&
  'addEditViewSidePanel' in candidate &&
  typeof candidate.addEditViewSidePanel === 'function';

export default {
  register(app: StrapiApp) {
    app.registerPlugin({ id: PLUGIN_ID, name: english.name });
    app.addSettingsLink('global', {
      id: PLUGIN_ID,
      to: PLUGIN_ID,
      intlLabel: descriptor('name'),
      permissions: [{ action: PERMISSIONS.readSettings }],
      Component: async () => ({ default: (await import('./pages/SettingsPage')).SettingsPage }),
    });
    app.addMenuLink({
      to: `plugins/${PLUGIN_ID}`,
      icon: Earth,
      intlLabel: descriptor('jobs.title'),
      permissions: Object.values(PERMISSIONS).map((action) => ({ action })),
      Component: async () => ({ default: (await import('./pages/JobsPage')).JobsPage }),
    });
  },
  bootstrap(app: StrapiApp) {
    const api = app.getPlugin('content-manager').apis;
    if (!isContentManagerApi(api)) throw new Error(messages.adminIncompatible().text);
    api.addDocumentAction([TranslateAction]);
    api.addBulkAction([TranslateBulkAction]);
    api.addEditViewSidePanel([TranslationPanel]);
  },
  async registerTrads({ locales }: { locales: string[] }) {
    return Promise.all(
      locales.map(async (locale) => {
        const loader = translations.get(locale.toLowerCase().split('-')[0] ?? locale);
        const dictionary = loader ? (await loader()).default : english;
        return {
          locale,
          data: Object.fromEntries(
            Object.entries(dictionary).map(([key, value]) => [`${PLUGIN_ID}.${key}`, value])
          ),
        };
      })
    );
  },
};
