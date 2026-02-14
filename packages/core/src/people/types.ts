/**
 * People types - Human participants in the assistants ecosystem
 */

export type PersonStatus = 'active' | 'inactive';

/**
 * A person (human participant)
 */
export interface Person {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  role?: string;
  notes?: string;
  avatar?: string;
  status: PersonStatus;
  defaultIdentityId?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Summary item for person listing
 */
export interface PersonListItem {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  role?: string;
  status: PersonStatus;
  isActive: boolean;
}

/**
 * Member type for channels and other systems
 */
export type MemberType = 'person' | 'assistant';

/**
 * Options for creating a person
 */
export interface CreatePersonOptions {
  name: string;
  email?: string;
  phone?: string;
  role?: string;
  notes?: string;
  avatar?: string;
}
