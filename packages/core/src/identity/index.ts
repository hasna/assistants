export * from './types';
export { AssistantManager } from './assistant-manager';
export { IdentityManager } from './identity-manager';
export {
  IDENTITY_TEMPLATES,
  getTemplate,
  listTemplates,
  createIdentityFromTemplate,
  type IdentityTemplate,
} from './templates';
export {
  SYSTEM_ASSISTANT_IDS,
  DEFAULT_SYSTEM_ASSISTANT_ID,
  isSystemAssistantId,
  getSystemAssistantDefinitions,
  buildSystemAssistant,
  type SystemAssistantId,
} from './system-assistants';
