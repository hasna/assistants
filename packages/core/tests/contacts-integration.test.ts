import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { ContactsStore } from '../src/contacts/store';
import { ContactsManager } from '../src/contacts/manager';
import { createContactsToolExecutors } from '../src/contacts/tools';
import { createTestDatabase } from './fixtures/test-db';

describe('ContactsStore', () => {
  let store: ContactsStore;

  beforeAll(() => {
    store = new ContactsStore(createTestDatabase());
  });

  afterAll(() => {
    store.close();
  });

  it('creates a contact with all fields', () => {
    const contact = store.createContact('John Doe', {
      company: 'Acme Corp',
      title: 'Engineer',
      birthday: '1990-05-15',
      relationship: 'colleague',
      favorite: true,
      emails: [{ email: 'john@acme.com', label: 'work', isPrimary: true }],
      phones: [{ phone: '+1-555-0100', label: 'mobile', isPrimary: true }],
      addresses: [{ street: '123 Main St', city: 'Springfield', state: 'IL', postalCode: '62701', country: 'US', label: 'home' }],
      social: [{ platform: 'github', handle: 'johndoe' }],
      tags: ['engineering', 'team-lead'],
    });

    expect(contact.id).toStartWith('ct_');
    expect(contact.name).toBe('John Doe');
    expect(contact.company).toBe('Acme Corp');
    expect(contact.title).toBe('Engineer');
    expect(contact.birthday).toBe('1990-05-15');
    expect(contact.relationship).toBe('colleague');
    expect(contact.favorite).toBe(true);
    expect(contact.emails).toHaveLength(1);
    expect(contact.emails[0].email).toBe('john@acme.com');
    expect(contact.emails[0].isPrimary).toBe(true);
    expect(contact.phones).toHaveLength(1);
    expect(contact.phones[0].phone).toBe('+1-555-0100');
    expect(contact.addresses).toHaveLength(1);
    expect(contact.addresses[0].city).toBe('Springfield');
    expect(contact.social).toHaveLength(1);
    expect(contact.social[0].platform).toBe('github');
    expect(contact.tags).toEqual(['engineering', 'team-lead']);
  });

  it('gets a contact by ID', () => {
    const list = store.listContacts();
    expect(list.length).toBeGreaterThan(0);
    const contact = store.getContact(list[0].id);
    expect(contact).not.toBeNull();
    expect(contact!.name).toBe('John Doe');
  });

  it('updates a contact', () => {
    const list = store.listContacts();
    const updated = store.updateContact(list[0].id, {
      company: 'New Corp',
      tags: ['engineering', 'mentor'],
    });
    expect(updated).not.toBeNull();
    expect(updated!.company).toBe('New Corp');
    expect(updated!.tags).toEqual(['engineering', 'mentor']);
  });

  it('lists contacts', () => {
    const list = store.listContacts();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('John Doe');
    expect(list[0].primaryEmail).toBe('john@acme.com');
    expect(list[0].favorite).toBe(true);
  });

  it('searches contacts', () => {
    const results = store.searchContacts('John');
    expect(results).toHaveLength(1);
    const noResults = store.searchContacts('nonexistent');
    expect(noResults).toHaveLength(0);
  });

  it('creates and manages groups', () => {
    const contact2 = store.createContact('Jane Smith', {
      emails: [{ email: 'jane@test.com', isPrimary: true }],
    });

    const group = store.createGroup('Engineering', 'Engineering team');
    expect(group.id).toStartWith('grp_');
    expect(group.name).toBe('Engineering');

    const list = store.listContacts();
    store.addGroupMember(group.id, list[0].id);
    store.addGroupMember(group.id, contact2.id);

    const groups = store.listGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].memberCount).toBe(2);

    const members = store.getGroupMembers(group.id);
    expect(members).toHaveLength(2);

    // Filter by group
    const filtered = store.listContacts({ group: group.id });
    expect(filtered).toHaveLength(2);

    // Remove member
    store.removeGroupMember(group.id, contact2.id);
    const membersAfter = store.getGroupMembers(group.id);
    expect(membersAfter).toHaveLength(1);

    // Delete group
    store.deleteGroup(group.id);
    expect(store.listGroups()).toHaveLength(0);

    // Clean up
    store.deleteContact(contact2.id);
  });

  it('filters by tag', () => {
    const results = store.listContacts({ tag: 'mentor' });
    expect(results).toHaveLength(1);
  });

  it('filters by favorite', () => {
    const results = store.listContacts({ favorite: true });
    expect(results).toHaveLength(1);
    const nonFav = store.listContacts({ favorite: false });
    expect(nonFav).toHaveLength(0);
  });

  it('filters by relationship', () => {
    const results = store.listContacts({ relationship: 'colleague' });
    expect(results).toHaveLength(1);
    const none = store.listContacts({ relationship: 'family' });
    expect(none).toHaveLength(0);
  });

  it('deletes a contact', () => {
    const list = store.listContacts();
    const deleted = store.deleteContact(list[0].id);
    expect(deleted).toBe(true);
    expect(store.listContacts()).toHaveLength(0);
  });
});

describe('ContactsManager', () => {
  let manager: ContactsManager;

  beforeAll(() => {
    manager = new ContactsManager(new ContactsStore(createTestDatabase()));
  });

  afterAll(() => {
    manager.close();
  });

  it('creates a contact with validation', () => {
    const contact = manager.createContact({ name: 'Alice', emails: [{ email: 'alice@test.com' }] });
    expect(contact.name).toBe('Alice');
  });

  it('rejects empty name', () => {
    expect(() => manager.createContact({ name: '' })).toThrow('Contact name is required');
  });

  it('rejects invalid email format', () => {
    expect(() => manager.createContact({ name: 'Bad', emails: [{ email: 'not-an-email' }] })).toThrow('Invalid email format');
  });

  it('rejects invalid birthday format', () => {
    expect(() => manager.createContact({ name: 'Bad', birthday: 'not-a-date' })).toThrow('Birthday must be in ISO format');
  });

  it('rejects invalid relationship', () => {
    expect(() => manager.createContact({ name: 'Bad', relationship: 'unknown' as any })).toThrow('Invalid relationship');
  });

  it('rejects duplicate group names', () => {
    manager.createGroup('TestGroup');
    expect(() => manager.createGroup('TestGroup')).toThrow('already exists');
  });

  it('searches contacts', () => {
    const results = manager.searchContacts('Alice');
    expect(results).toHaveLength(1);
  });
});

describe('ContactsToolExecutors', () => {
  let manager: ContactsManager;
  let executors: Record<string, (input: any) => Promise<string>>;

  beforeAll(() => {
    manager = new ContactsManager(new ContactsStore(createTestDatabase()));
    executors = createContactsToolExecutors(() => manager) as any;
  });

  afterAll(() => {
    manager.close();
  });

  it('contacts_create creates a contact', async () => {
    const result = await executors.contacts_create({ name: 'Bob', company: 'Tool Co', emails: [{ email: 'bob@tool.co' }] });
    expect(result).toContain('Contact created: Bob');
  });

  it('contacts_list lists contacts', async () => {
    const result = await executors.contacts_list({});
    expect(result).toContain('Bob');
    expect(result).toContain('Contacts (1)');
  });

  it('contacts_search finds contacts', async () => {
    const result = await executors.contacts_search({ query: 'Bob' });
    expect(result).toContain('Bob');
  });

  it('contacts_get retrieves contact details', async () => {
    const list = manager.listContacts();
    const result = await executors.contacts_get({ id: list[0].id });
    expect(result).toContain('Name: Bob');
    expect(result).toContain('Company: Tool Co');
  });

  it('contacts_update updates a contact', async () => {
    const list = manager.listContacts();
    const result = await executors.contacts_update({ id: list[0].id, company: 'Updated Co' });
    expect(result).toContain('Company: Updated Co');
  });

  it('contacts_groups_create creates a group', async () => {
    const result = await executors.contacts_groups_create({ name: 'Dev Team', description: 'Developers' });
    expect(result).toContain('Group created: Dev Team');
  });

  it('contacts_groups_list lists groups', async () => {
    const result = await executors.contacts_groups_list({});
    expect(result).toContain('Dev Team');
  });

  it('contacts_groups_add_member adds a member', async () => {
    const list = manager.listContacts();
    const groups = manager.listGroups();
    const result = await executors.contacts_groups_add_member({ group_id: groups[0].id, contact_id: list[0].id });
    expect(result).toContain('added to group');
  });

  it('contacts_groups_remove_member removes a member', async () => {
    const list = manager.listContacts();
    const groups = manager.listGroups();
    const result = await executors.contacts_groups_remove_member({ group_id: groups[0].id, contact_id: list[0].id });
    expect(result).toContain('removed from group');
  });

  it('contacts_delete deletes a contact', async () => {
    const list = manager.listContacts();
    const result = await executors.contacts_delete({ id: list[0].id });
    expect(result).toContain('Contact deleted');
  });

  it('contacts_groups_delete deletes a group', async () => {
    const groups = manager.listGroups();
    const result = await executors.contacts_groups_delete({ id: groups[0].id });
    expect(result).toContain('Group deleted');
  });

  it('returns error for missing manager', async () => {
    const nullExecutors = createContactsToolExecutors(() => null) as any;
    const result = await nullExecutors.contacts_list({});
    expect(result).toBe('Contacts system is not available.');
  });
});
