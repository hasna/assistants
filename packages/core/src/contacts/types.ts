/**
 * Contacts types - Address book with groups
 */

export type ContactRelationship = 'friend' | 'colleague' | 'vendor' | 'client' | 'family' | 'other';

export interface ContactEmail {
  id: number;
  contactId: string;
  email: string;
  label: string;
  isPrimary: boolean;
}

export interface ContactPhone {
  id: number;
  contactId: string;
  phone: string;
  label: string;
  isPrimary: boolean;
}

export interface ContactAddress {
  id: number;
  contactId: string;
  street?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  label: string;
}

export interface ContactSocial {
  id: number;
  contactId: string;
  platform: string;
  handle: string;
}

export interface ContactGroupRef {
  id: string;
  name: string;
}

export interface Contact {
  id: string;
  name: string;
  company?: string;
  title?: string;
  birthday?: string;
  relationship: ContactRelationship;
  notes?: string;
  favorite: boolean;
  emails: ContactEmail[];
  phones: ContactPhone[];
  addresses: ContactAddress[];
  social: ContactSocial[];
  tags: string[];
  groups: ContactGroupRef[];
  createdAt: number;
  updatedAt: number;
}

export interface ContactListItem {
  id: string;
  name: string;
  company?: string;
  primaryEmail?: string;
  primaryPhone?: string;
  favorite: boolean;
  tags: string[];
  relationship: ContactRelationship;
}

export interface ContactGroup {
  id: string;
  name: string;
  description?: string;
  memberCount: number;
  createdAt: number;
}

export interface CreateContactOptions {
  name: string;
  company?: string;
  title?: string;
  birthday?: string;
  relationship?: ContactRelationship;
  notes?: string;
  favorite?: boolean;
  emails?: { email: string; label?: string; isPrimary?: boolean }[];
  phones?: { phone: string; label?: string; isPrimary?: boolean }[];
  addresses?: Omit<ContactAddress, 'id' | 'contactId'>[];
  social?: { platform: string; handle: string }[];
  tags?: string[];
}

export interface UpdateContactOptions extends Partial<Omit<CreateContactOptions, 'name'>> {
  name?: string;
}

export interface ContactsListOptions {
  query?: string;
  tag?: string;
  group?: string;
  relationship?: ContactRelationship;
  favorite?: boolean;
  limit?: number;
  offset?: number;
}
