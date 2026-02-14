/**
 * People module exports
 * Human participants in the assistants ecosystem
 */

export { PeopleStore } from './store';
export { PeopleManager, createPeopleManager } from './manager';
export {
  peopleTools,
  peopleListTool,
  peopleGetTool,
  peopleCreateTool,
  peopleUpdateTool,
  peopleDeleteTool,
  peopleLoginTool,
  peopleLogoutTool,
  peopleWhoamiTool,
  createPeopleToolExecutors,
  registerPeopleTools,
} from './tools';
export type {
  Person,
  PersonListItem,
  PersonStatus,
  MemberType,
  CreatePersonOptions,
} from './types';
