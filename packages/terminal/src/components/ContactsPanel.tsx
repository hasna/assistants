import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import type { ContactsManager, ContactListItem, Contact, ContactGroup, ContactGroupRef } from '@hasna/assistants-core';
import { useSafeInput as useInput } from '../hooks/useSafeInput';

interface ContactsPanelProps {
  manager: ContactsManager;
  onClose: () => void;
}

type Mode =
  | 'list'
  | 'view'
  | 'create-name'
  | 'create-email'
  | 'create-phone'
  | 'create-company'
  | 'create-confirm'
  | 'delete-confirm'
  | 'search'
  | 'groups'
  | 'group-view';

export function ContactsPanel({ manager, onClose }: ContactsPanelProps) {
  const [mode, setMode] = useState<Mode>('list');
  const [contacts, setContacts] = useState<ContactListItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // View state
  const [viewContact, setViewContact] = useState<Contact | null>(null);

  // Create wizard state
  const [createName, setCreateName] = useState('');
  const [createEmail, setCreateEmail] = useState('');
  const [createPhone, setCreatePhone] = useState('');
  const [createCompany, setCreateCompany] = useState('');

  // Search state
  const [searchQuery, setSearchQuery] = useState('');

  // Groups state
  const [groups, setGroups] = useState<ContactGroup[]>([]);
  const [selectedGroupIndex, setSelectedGroupIndex] = useState(0);
  const [viewGroup, setViewGroup] = useState<ContactGroup | null>(null);
  const [groupMembers, setGroupMembers] = useState<ContactListItem[]>([]);

  const loadContacts = () => {
    try {
      const list = manager.listContacts({ limit: 100 });
      setContacts(list);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const loadGroups = () => {
    try {
      const list = manager.listGroups();
      setGroups(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    loadContacts();
  }, []);

  useEffect(() => {
    setSelectedIndex((prev) => Math.min(prev, Math.max(0, contacts.length - 1)));
  }, [contacts.length]);

  useInput((input, key) => {
    const isTextEntry = mode === 'create-name' || mode === 'create-email' ||
      mode === 'create-phone' || mode === 'create-company' || mode === 'search';

    if (key.escape || (input === 'q' && !isTextEntry)) {
      if (mode === 'list') {
        onClose();
      } else if (mode === 'view') {
        setMode('list');
        setViewContact(null);
      } else if (mode === 'groups') {
        setMode('list');
      } else if (mode === 'group-view') {
        setMode('groups');
        setViewGroup(null);
        setGroupMembers([]);
      } else if (key.escape) {
        setMode('list');
        setStatusMessage(null);
      }
      return;
    }

    if (isTextEntry) return;

    if (mode === 'list') {
      if (key.upArrow || input === 'k') {
        setSelectedIndex((prev) => Math.max(0, prev - 1));
      } else if (key.downArrow || input === 'j') {
        if (contacts.length > 0) {
          setSelectedIndex((prev) => Math.min(contacts.length - 1, prev + 1));
        }
      } else if (key.return && contacts.length > 0) {
        const c = contacts[selectedIndex];
        const full = manager.getContact(c.id);
        if (full) {
          setViewContact(full);
          setMode('view');
        }
      } else if (input === 'c') {
        setCreateName('');
        setCreateEmail('');
        setCreatePhone('');
        setCreateCompany('');
        setMode('create-name');
      } else if (input === 'd' && contacts.length > 0) {
        setMode('delete-confirm');
      } else if (input === 's' || input === '/') {
        setSearchQuery('');
        setMode('search');
      } else if (input === 'g') {
        loadGroups();
        setSelectedGroupIndex(0);
        setMode('groups');
      } else if (input === 'f' && contacts.length > 0) {
        const c = contacts[selectedIndex];
        const full = manager.getContact(c.id);
        if (full) {
          manager.updateContact(c.id, { favorite: !full.favorite });
          setStatusMessage(full.favorite ? `Unfavorited ${c.name}` : `Favorited ${c.name}`);
          loadContacts();
        }
      } else if (input === 'r') {
        loadContacts();
        setStatusMessage('Refreshed');
      }
    } else if (mode === 'view') {
      if (input === 'f' && viewContact) {
        manager.updateContact(viewContact.id, { favorite: !viewContact.favorite });
        const updated = manager.getContact(viewContact.id);
        if (updated) setViewContact(updated);
        loadContacts();
      }
    } else if (mode === 'delete-confirm') {
      if (input === 'y' && contacts.length > 0) {
        const c = contacts[selectedIndex];
        const deleted = manager.deleteContact(c.id);
        if (deleted) {
          setStatusMessage(`Deleted ${c.name}`);
          loadContacts();
          if (selectedIndex >= contacts.length - 1) {
            setSelectedIndex(Math.max(0, selectedIndex - 1));
          }
        } else {
          setStatusMessage('Error deleting contact');
        }
        setMode('list');
      } else if (input === 'n') {
        setMode('list');
      }
    } else if (mode === 'create-confirm') {
      if (input === 'y') {
        try {
          const contact = manager.createContact({
            name: createName,
            company: createCompany || undefined,
            emails: createEmail ? [{ email: createEmail, label: 'personal', isPrimary: true }] : undefined,
            phones: createPhone ? [{ phone: createPhone, label: 'mobile', isPrimary: true }] : undefined,
          });
          setStatusMessage(`Created ${contact.name}`);
          setMode('list');
          loadContacts();
        } catch (err) {
          setStatusMessage(`Error: ${err instanceof Error ? err.message : String(err)}`);
          setMode('list');
        }
      } else if (input === 'n') {
        setMode('list');
      }
    } else if (mode === 'groups') {
      if (key.upArrow || input === 'k') {
        setSelectedGroupIndex((prev) => Math.max(0, prev - 1));
      } else if (key.downArrow || input === 'j') {
        if (groups.length > 0) {
          setSelectedGroupIndex((prev) => Math.min(groups.length - 1, prev + 1));
        }
      } else if (key.return && groups.length > 0) {
        const g = groups[selectedGroupIndex];
        setViewGroup(g);
        const members = manager.getGroupMembers(g.id);
        setGroupMembers(members);
        setMode('group-view');
      }
    }
  });

  // Helpers
  const truncate = (str: string, max: number) => str.length > max ? str.slice(0, max - 1) + '~' : str;

  // Header
  const getHeaderHints = () => {
    switch (mode) {
      case 'list': return 'q:close c:create enter:view d:delete s:search g:groups f:fav r:refresh';
      case 'view': return 'q:back f:toggle-fav';
      case 'delete-confirm': return 'y:confirm n:cancel';
      case 'create-confirm': return 'y:confirm n:cancel';
      case 'groups': return 'q:back enter:view';
      case 'group-view': return 'q:back';
      default: return 'Enter to continue, Esc to cancel';
    }
  };

  const header = (
    <Box borderStyle="round" borderColor="#d4d4d8" borderLeft={false} borderRight={false} paddingX={1} marginBottom={1}>
      <Text bold color="blue">Contacts</Text>
      <Text color="gray"> | </Text>
      <Text color="gray">{getHeaderHints()}</Text>
    </Box>
  );

  const statusBar = statusMessage ? (
    <Box marginBottom={1}>
      <Text color="yellow">{statusMessage}</Text>
    </Box>
  ) : null;

  const errorBar = error ? (
    <Box marginBottom={1}>
      <Text color="red">Error: {error}</Text>
    </Box>
  ) : null;

  // Search mode
  if (mode === 'search') {
    return (
      <Box flexDirection="column">
        {header}
        <Box paddingX={1} flexDirection="column">
          <Text bold>Search Contacts</Text>
          <Text> </Text>
          <Box>
            <Text>Query: </Text>
            <TextInput
              value={searchQuery}
              onChange={setSearchQuery}
              onSubmit={() => {
                if (searchQuery.trim()) {
                  const results = manager.searchContacts(searchQuery.trim());
                  setContacts(results);
                  setSelectedIndex(0);
                  setStatusMessage(`Found ${results.length} contact(s)`);
                } else {
                  loadContacts();
                  setStatusMessage(null);
                }
                setMode('list');
              }}
              focus
              placeholder="Search by name, email, company..."
            />
          </Box>
        </Box>
      </Box>
    );
  }

  // View contact detail
  if (mode === 'view' && viewContact) {
    return (
      <Box flexDirection="column">
        {header}
        <Box paddingX={1} flexDirection="column">
          <Text bold color="blue">
            {viewContact.favorite ? '* ' : ''}{viewContact.name}
          </Text>
          <Text color="gray">ID: {viewContact.id}</Text>
          <Text> </Text>
          {viewContact.company && <Text>Company: {viewContact.company}</Text>}
          {viewContact.title && <Text>Title: {viewContact.title}</Text>}
          {viewContact.birthday && <Text>Birthday: {viewContact.birthday}</Text>}
          <Text>Relationship: {viewContact.relationship}</Text>
          {viewContact.emails.length > 0 && (
            <>
              <Text> </Text>
              <Text bold>Emails:</Text>
              {viewContact.emails.map((e, i) => (
                <Text key={i}>  {e.email} ({e.label}){e.isPrimary ? ' [primary]' : ''}</Text>
              ))}
            </>
          )}
          {viewContact.phones.length > 0 && (
            <>
              <Text> </Text>
              <Text bold>Phones:</Text>
              {viewContact.phones.map((p, i) => (
                <Text key={i}>  {p.phone} ({p.label}){p.isPrimary ? ' [primary]' : ''}</Text>
              ))}
            </>
          )}
          {viewContact.addresses.length > 0 && (
            <>
              <Text> </Text>
              <Text bold>Addresses:</Text>
              {viewContact.addresses.map((a, i) => {
                const parts = [a.street, a.city, a.state, a.postalCode, a.country].filter(Boolean);
                return <Text key={i}>  {parts.join(', ')} ({a.label})</Text>;
              })}
            </>
          )}
          {viewContact.social.length > 0 && (
            <>
              <Text> </Text>
              <Text bold>Social:</Text>
              {viewContact.social.map((s, i) => (
                <Text key={i}>  {s.platform}: {s.handle}</Text>
              ))}
            </>
          )}
          {viewContact.tags.length > 0 && (
            <>
              <Text> </Text>
              <Text>Tags: {viewContact.tags.join(', ')}</Text>
            </>
          )}
          {viewContact.groups.length > 0 && (
            <Text>Groups: {viewContact.groups.map((g: ContactGroupRef) => g.name).join(', ')}</Text>
          )}
          {viewContact.notes && (
            <>
              <Text> </Text>
              <Text>Notes: {viewContact.notes}</Text>
            </>
          )}
        </Box>
      </Box>
    );
  }

  // Delete confirm
  if (mode === 'delete-confirm' && contacts.length > 0) {
    const c = contacts[selectedIndex];
    return (
      <Box flexDirection="column">
        {header}
        <Box paddingX={1} flexDirection="column">
          <Text color="red" bold>Delete contact?</Text>
          <Text> </Text>
          <Text>This will permanently delete {c.name} ({c.id})</Text>
          <Text> </Text>
          <Text>Press 'y' to confirm, 'n' to cancel.</Text>
        </Box>
      </Box>
    );
  }

  // Create wizard: name
  if (mode === 'create-name') {
    return (
      <Box flexDirection="column">
        {header}
        <Box paddingX={1} flexDirection="column">
          <Text bold>Create Contact</Text>
          <Text> </Text>
          <Box>
            <Text>Name: </Text>
            <TextInput
              value={createName}
              onChange={setCreateName}
              onSubmit={() => {
                if (createName.trim()) setMode('create-email');
              }}
              focus
              placeholder="e.g., John Doe"
            />
          </Box>
        </Box>
      </Box>
    );
  }

  // Create wizard: email
  if (mode === 'create-email') {
    return (
      <Box flexDirection="column">
        {header}
        <Box paddingX={1} flexDirection="column">
          <Text bold>Create Contact</Text>
          <Text>Name: {createName}</Text>
          <Text> </Text>
          <Box>
            <Text>Email: </Text>
            <TextInput
              value={createEmail}
              onChange={setCreateEmail}
              onSubmit={() => setMode('create-phone')}
              focus
              placeholder="(optional) e.g., john@example.com"
            />
          </Box>
        </Box>
      </Box>
    );
  }

  // Create wizard: phone
  if (mode === 'create-phone') {
    return (
      <Box flexDirection="column">
        {header}
        <Box paddingX={1} flexDirection="column">
          <Text bold>Create Contact</Text>
          <Text>Name: {createName}</Text>
          {createEmail && <Text>Email: {createEmail}</Text>}
          <Text> </Text>
          <Box>
            <Text>Phone: </Text>
            <TextInput
              value={createPhone}
              onChange={setCreatePhone}
              onSubmit={() => setMode('create-company')}
              focus
              placeholder="(optional) e.g., +1-555-123-4567"
            />
          </Box>
        </Box>
      </Box>
    );
  }

  // Create wizard: company
  if (mode === 'create-company') {
    return (
      <Box flexDirection="column">
        {header}
        <Box paddingX={1} flexDirection="column">
          <Text bold>Create Contact</Text>
          <Text>Name: {createName}</Text>
          {createEmail && <Text>Email: {createEmail}</Text>}
          {createPhone && <Text>Phone: {createPhone}</Text>}
          <Text> </Text>
          <Box>
            <Text>Company: </Text>
            <TextInput
              value={createCompany}
              onChange={setCreateCompany}
              onSubmit={() => setMode('create-confirm')}
              focus
              placeholder="(optional) e.g., Acme Corp"
            />
          </Box>
        </Box>
      </Box>
    );
  }

  // Create wizard: confirm
  if (mode === 'create-confirm') {
    return (
      <Box flexDirection="column">
        {header}
        <Box paddingX={1} flexDirection="column">
          <Text bold>Confirm Contact Creation</Text>
          <Text> </Text>
          <Text>Name:    {createName}</Text>
          {createEmail && <Text>Email:   {createEmail}</Text>}
          {createPhone && <Text>Phone:   {createPhone}</Text>}
          {createCompany && <Text>Company: {createCompany}</Text>}
          <Text> </Text>
          <Text>Press 'y' to create, 'n' to cancel.</Text>
        </Box>
      </Box>
    );
  }

  // Groups list
  if (mode === 'groups') {
    return (
      <Box flexDirection="column">
        {header}
        {statusBar}
        {groups.length === 0 ? (
          <Box paddingX={1}>
            <Text color="gray">No groups. Groups can be created via the AI assistant.</Text>
          </Box>
        ) : (
          <Box flexDirection="column" paddingX={1}>
            {groups.map((g, i) => (
              <Box key={g.id}>
                <Text color={i === selectedGroupIndex ? 'blue' : undefined}>
                  {i === selectedGroupIndex ? '> ' : '  '}
                </Text>
                <Text bold={i === selectedGroupIndex} color={i === selectedGroupIndex ? 'blue' : undefined}>
                  {g.name}
                </Text>
                <Text color="gray"> ({g.memberCount} members)</Text>
                {g.description && <Text color="gray"> - {g.description}</Text>}
              </Box>
            ))}
          </Box>
        )}
      </Box>
    );
  }

  // Group view
  if (mode === 'group-view' && viewGroup) {
    return (
      <Box flexDirection="column">
        {header}
        <Box paddingX={1} flexDirection="column">
          <Text bold color="blue">{viewGroup.name}</Text>
          {viewGroup.description && <Text color="gray">{viewGroup.description}</Text>}
          <Text color="gray">{viewGroup.memberCount} members</Text>
          <Text> </Text>
          {groupMembers.length === 0 ? (
            <Text color="gray">No members in this group.</Text>
          ) : (
            groupMembers.map((m) => {
              const email = m.primaryEmail ? ` <${m.primaryEmail}>` : '';
              const company = m.company ? ` @ ${m.company}` : '';
              return (
                <Text key={m.id}>  - {m.name}{company}{email}</Text>
              );
            })
          )}
        </Box>
      </Box>
    );
  }

  // List view (default)
  return (
    <Box flexDirection="column">
      {header}
      {statusBar}
      {errorBar}
      {contacts.length === 0 ? (
        <Box paddingX={1}>
          <Text color="gray">No contacts. Press 'c' to create one, or ask the AI to add contacts.</Text>
        </Box>
      ) : (
        <Box flexDirection="column" paddingX={1}>
          {contacts.map((c, i) => (
            <Box key={c.id}>
              <Text color={i === selectedIndex ? 'blue' : undefined}>
                {i === selectedIndex ? '> ' : '  '}
              </Text>
              <Text bold={i === selectedIndex} color={i === selectedIndex ? 'blue' : undefined}>
                {c.favorite ? '* ' : ''}{truncate(c.name, 16).padEnd(16)}
              </Text>
              <Text color="gray">
                {' '}{truncate(c.company || '', 14).padEnd(14)}
              </Text>
              <Text>
                {' '}{truncate(c.primaryEmail || '', 24).padEnd(24)}
              </Text>
              {c.tags.length > 0 && (
                <Text color="gray"> [{c.tags.join(', ')}]</Text>
              )}
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
