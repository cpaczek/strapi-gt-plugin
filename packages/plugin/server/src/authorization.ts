import type { Core } from '@strapi/strapi';
import type { JsonObject } from '../../shared/contracts';
import { PERMISSIONS } from '../../shared/constants';
import { messages } from '../../shared/messages';
import { DiagnosticError, objectRecord } from './validation';

export type ContentAction = 'read' | 'create' | 'update' | 'publish';
export interface AuthorizationInput {
  pluginAllowed: boolean;
  source: JsonObject;
  target: JsonObject | null;
  targetLocale: string;
  fields: string[];
  createMissingLocales: boolean;
  publish: boolean;
  can(action: ContentAction, entity: JsonObject, field?: string): boolean;
}
export const denied = (): never => {
  throw new DiagnosticError(messages.permissionDenied(), 403);
};
export const authorizeDocument = (input: AuthorizationInput): void => {
  if (!input.pluginAllowed) denied();
  if (!input.target && !input.createMissingLocales)
    throw new DiagnosticError(messages.missingLocale(input.targetLocale));
  const target = input.target ?? { locale: input.targetLocale };
  const action = input.target ? 'update' : 'create';
  if (!input.can('read', input.source) || !input.can(action, target)) denied();
  for (const field of input.fields) {
    if (!input.can('read', input.source, field) || !input.can(action, target, field)) denied();
  }
  if (input.publish && !input.can('publish', target)) denied();
};
interface Ability {
  can(action: string): boolean;
}
interface Checker {
  can(action: string, entity: JsonObject, field?: string): boolean;
}
const isAbility = (value: unknown): value is Ability =>
  objectRecord(value) && typeof value.can === 'function';
const isChecker = (value: unknown): value is Checker =>
  objectRecord(value) && typeof value.can === 'function';
const isGenerator = (
  value: unknown
): value is { generateUserAbility(user: unknown): Promise<unknown> } =>
  objectRecord(value) && typeof value.generateUserAbility === 'function';
const isCheckerFactory = (
  value: unknown
): value is { create(input: { userAbility: Ability; model: string }): unknown } =>
  objectRecord(value) && typeof value.create === 'function';
export interface ActorPermissions {
  plugin(action: keyof typeof PERMISSIONS): boolean;
  checker(model: string): Checker;
}

export const loadActorPermissions = async (
  strapi: Core.Strapi,
  actorId: number | null
): Promise<ActorPermissions> => {
  if (!actorId) return denied();
  const user: unknown = await strapi.db
    .query('admin::user')
    .findOne({ where: { id: actorId }, populate: ['roles'] });
  if (!objectRecord(user) || user.isActive !== true || user.blocked === true) return denied();
  const permissionService: unknown = strapi.service('admin::permission');
  const checkerService: unknown = strapi.plugin('content-manager').service('permission-checker');
  if (
    !objectRecord(permissionService) ||
    !isGenerator(permissionService.engine) ||
    !isCheckerFactory(checkerService)
  )
    return denied();
  const ability = await permissionService.engine.generateUserAbility(user);
  if (!isAbility(ability)) return denied();
  return {
    plugin: (action) => ability.can(PERMISSIONS[action]),
    checker: (model) => {
      const checker = checkerService.create({ userAbility: ability, model });
      if (!isChecker(checker)) return denied();
      return checker;
    },
  };
};
export const checkContent =
  (checker: Checker) =>
  (action: ContentAction, entity: JsonObject, field?: string): boolean =>
    checker.can(`plugin::content-manager.explorer.${action}`, entity, field);
