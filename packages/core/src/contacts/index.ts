/**
 * Contacts module exports
 * Address book with groups for the assistants ecosystem
 */

export { ContactsStore } from './store';
export { ContactsManager, createContactsManager } from './manager';
export {
  contactsTools,
  contactsListTool,
  contactsGetTool,
  contactsCreateTool,
  contactsUpdateTool,
  contactsDeleteTool,
  contactsSearchTool,
  contactsGroupsListTool,
  contactsGroupsCreateTool,
  contactsGroupsDeleteTool,
  contactsGroupsAddMemberTool,
  contactsGroupsRemoveMemberTool,
  createContactsToolExecutors,
  registerContactsTools,
} from './tools';
export type {
  Contact,
  ContactEmail,
  ContactPhone,
  ContactAddress,
  ContactSocial,
  ContactGroupRef,
  ContactListItem,
  ContactGroup,
  ContactRelationship,
  CreateContactOptions,
  UpdateContactOptions,
  ContactsListOptions,
} from './types';
