import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import type { PeopleManager, PersonListItem, Person } from '@hasna/assistants-core';
import { useSafeInput as useInput } from '../hooks/useSafeInput';

interface PeoplePanelProps {
  manager: PeopleManager;
  onClose: () => void;
}

type Mode =
  | 'list'
  | 'view'
  | 'create-name'
  | 'create-email'
  | 'create-phone'
  | 'create-role'
  | 'create-notes'
  | 'create-confirm'
  | 'delete-confirm';

export function PeoplePanel({ manager, onClose }: PeoplePanelProps) {
  const [mode, setMode] = useState<Mode>('list');
  const [people, setPeople] = useState<PersonListItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // View state
  const [viewPerson, setViewPerson] = useState<Person | null>(null);

  // Create wizard state
  const [createName, setCreateName] = useState('');
  const [createEmail, setCreateEmail] = useState('');
  const [createPhone, setCreatePhone] = useState('');
  const [createRole, setCreateRole] = useState('');
  const [createNotes, setCreateNotes] = useState('');

  const loadPeople = () => {
    try {
      const list = manager.listPeople();
      setPeople(list);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    loadPeople();
  }, []);

  useEffect(() => {
    setSelectedIndex((prev) => Math.min(prev, Math.max(0, people.length - 1)));
  }, [people.length]);

  useEffect(() => {
    if (mode === 'delete-confirm' && people.length === 0) {
      setMode('list');
    }
  }, [mode, people.length]);

  useInput((input, key) => {
    const isTextEntry = mode === 'create-name' || mode === 'create-email' ||
      mode === 'create-phone' || mode === 'create-role' || mode === 'create-notes';

    if (key.escape || (input === 'q' && !isTextEntry)) {
      if (mode === 'list') {
        onClose();
      } else if (mode === 'view') {
        setMode('list');
        setViewPerson(null);
      } else if (key.escape) {
        setMode('list');
        setStatusMessage(null);
      }
      return;
    }

    // Don't handle other keys during text entry - let TextInput receive them
    if (isTextEntry) return;

    if (mode === 'list') {
      if (key.upArrow || input === 'k') {
        setSelectedIndex((prev) => Math.max(0, prev - 1));
      } else if (key.downArrow || input === 'j') {
        if (people.length === 0) {
          setSelectedIndex(0);
        } else {
          setSelectedIndex((prev) => Math.min(people.length - 1, prev + 1));
        }
      } else if (key.return && people.length > 0) {
        const person = people[selectedIndex];
        const full = manager.getPerson(person.id);
        if (full) {
          setViewPerson(full);
          setMode('view');
        }
      } else if (input === 'a') {
        // 'a' for activate/login
        if (people.length > 0) {
          const person = people[selectedIndex];
          manager.setActivePerson(person.id).then(() => {
            setStatusMessage(`Logged in as ${person.name}`);
            loadPeople();
          }).catch((err: Error) => {
            setStatusMessage(`Error: ${err.message}`);
          });
        }
      } else if (input === 'c') {
        setCreateName('');
        setCreateEmail('');
        setCreatePhone('');
        setCreateRole('');
        setCreateNotes('');
        setMode('create-name');
      } else if (input === 'l') {
        manager.logout().then(() => {
          setStatusMessage('Logged out');
          loadPeople();
        });
      } else if (input === 'd' && people.length > 0) {
        setMode('delete-confirm');
      } else if (input === 'r') {
        loadPeople();
        setStatusMessage('Refreshed');
      }
    } else if (mode === 'view') {
      if (input === 'a' && viewPerson) {
        manager.setActivePerson(viewPerson.id).then(() => {
          setStatusMessage(`Logged in as ${viewPerson.name}`);
          loadPeople();
          setMode('list');
          setViewPerson(null);
        }).catch((err: Error) => {
          setStatusMessage(`Error: ${err.message}`);
        });
      }
    } else if (mode === 'delete-confirm') {
      if (input === 'y' && people.length > 0) {
        const person = people[selectedIndex];
        manager.deletePerson(person.id).then(() => {
          setStatusMessage(`Deleted ${person.name}`);
          setMode('list');
          loadPeople();
          if (selectedIndex >= people.length - 1) {
            setSelectedIndex(Math.max(0, selectedIndex - 1));
          }
        }).catch((err: Error) => {
          setStatusMessage(`Error: ${err.message}`);
          setMode('list');
        });
      } else if (input === 'n') {
        setMode('list');
      }
    } else if (mode === 'create-confirm') {
      if (input === 'y') {
        manager.createPerson({
          name: createName,
          email: createEmail || undefined,
          phone: createPhone || undefined,
          role: createRole || undefined,
          notes: createNotes || undefined,
        }).then((person) => {
          return manager.setActivePerson(person.id).then(() => {
            setStatusMessage(`Created and logged in as ${person.name}`);
            setMode('list');
            loadPeople();
          });
        }).catch((err: Error) => {
          setStatusMessage(`Error: ${err.message}`);
          setMode('list');
        });
      } else if (input === 'n') {
        setMode('list');
      }
    }
  });

  // Header
  const getHeaderHints = () => {
    switch (mode) {
      case 'list': return 'q:close c:create enter:view a:login l:logout d:delete r:refresh';
      case 'view': return 'q:back a:login';
      case 'delete-confirm': return 'y:confirm n:cancel';
      case 'create-confirm': return 'y:confirm n:cancel';
      default: return 'Enter to continue, Esc to cancel';
    }
  };

  const header = (
    <Box borderStyle="round" borderColor="#d4d4d8" borderLeft={false} borderRight={false} paddingX={1} marginBottom={1}>
      <Text bold color="green">People</Text>
      <Text color="gray"> | </Text>
      <Text color="gray">{getHeaderHints()}</Text>
    </Box>
  );

  // Status message
  const statusBar = statusMessage ? (
    <Box marginBottom={1}>
      <Text color="yellow">{statusMessage}</Text>
    </Box>
  ) : null;

  // Error bar
  const errorBar = error ? (
    <Box marginBottom={1}>
      <Text color="red">Error: {error}</Text>
    </Box>
  ) : null;

  // View person detail
  if (mode === 'view' && viewPerson) {
    return (
      <Box flexDirection="column">
        {header}
        <Box paddingX={1} flexDirection="column">
          <Text bold color="green">{viewPerson.name}</Text>
          <Text color="gray">ID: {viewPerson.id}</Text>
          <Text>{' '}</Text>
          {viewPerson.email && <Text>Email:  {viewPerson.email}</Text>}
          {viewPerson.phone && <Text>Phone:  {viewPerson.phone}</Text>}
          {viewPerson.role && <Text>Role:   {viewPerson.role}</Text>}
          <Text>Status: {viewPerson.status}</Text>
          {viewPerson.notes && (
            <Box flexDirection="column" marginTop={1}>
              <Text bold>Notes:</Text>
              <Text>  {viewPerson.notes}</Text>
            </Box>
          )}
          <Text>{' '}</Text>
          <Text dimColor>Created: {viewPerson.createdAt}</Text>
          <Text dimColor>Updated: {viewPerson.updatedAt}</Text>
        </Box>
      </Box>
    );
  }

  // List view
  if (mode === 'list') {
    return (
      <Box flexDirection="column">
        {header}
        {statusBar}
        {errorBar}
        {people.length === 0 ? (
          <Box paddingX={1}>
            <Text color="gray">No people registered. Press 'c' to create one.</Text>
          </Box>
        ) : (
          <Box flexDirection="column" paddingX={1}>
            {people.map((p) => (
              <Box key={p.id}>
                <Text color={p.id === people[selectedIndex]?.id ? 'green' : undefined}>
                  {p.id === people[selectedIndex]?.id ? '> ' : '  '}
                </Text>
                <Text bold={p.id === people[selectedIndex]?.id} color={p.id === people[selectedIndex]?.id ? 'green' : undefined}>
                  {p.name}
                </Text>
                {p.role && <Text color="gray"> ({p.role})</Text>}
                {p.email && <Text color="gray"> &lt;{p.email}&gt;</Text>}
                {p.phone && <Text dimColor> {p.phone}</Text>}
                {p.isActive && <Text color="cyan"> (active)</Text>}
              </Box>
            ))}
          </Box>
        )}
      </Box>
    );
  }

  // Delete confirm
  if (mode === 'delete-confirm' && people.length > 0) {
    const person = people[selectedIndex];
    return (
      <Box flexDirection="column">
        {header}
        <Box paddingX={1} flexDirection="column">
          <Text color="red" bold>Delete person?</Text>
          <Text>{' '}</Text>
          <Text>This will permanently delete {person.name} ({person.id})</Text>
          <Text>{' '}</Text>
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
          <Text bold>Create Person</Text>
          <Text>{' '}</Text>
          <Box>
            <Text>Name: </Text>
            <TextInput
              value={createName}
              onChange={setCreateName}
              onSubmit={() => {
                if (createName.trim()) setMode('create-email');
              }}
              focus
              placeholder="e.g., Andrei Hasna"
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
          <Text bold>Create Person</Text>
          <Text>Name: {createName}</Text>
          <Text>{' '}</Text>
          <Box>
            <Text>Email: </Text>
            <TextInput
              value={createEmail}
              onChange={setCreateEmail}
              onSubmit={() => setMode('create-phone')}
              focus
              placeholder="(optional) e.g., andrei@hasna.com"
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
          <Text bold>Create Person</Text>
          <Text>Name: {createName}</Text>
          {createEmail && <Text>Email: {createEmail}</Text>}
          <Text>{' '}</Text>
          <Box>
            <Text>Phone: </Text>
            <TextInput
              value={createPhone}
              onChange={setCreatePhone}
              onSubmit={() => setMode('create-role')}
              focus
              placeholder="(optional) e.g., +1-555-123-4567"
            />
          </Box>
        </Box>
      </Box>
    );
  }

  // Create wizard: role
  if (mode === 'create-role') {
    return (
      <Box flexDirection="column">
        {header}
        <Box paddingX={1} flexDirection="column">
          <Text bold>Create Person</Text>
          <Text>Name:  {createName}</Text>
          {createEmail && <Text>Email: {createEmail}</Text>}
          {createPhone && <Text>Phone: {createPhone}</Text>}
          <Text>{' '}</Text>
          <Box>
            <Text>Role: </Text>
            <TextInput
              value={createRole}
              onChange={setCreateRole}
              onSubmit={() => setMode('create-notes')}
              focus
              placeholder="(optional) e.g., Developer, Manager"
            />
          </Box>
        </Box>
      </Box>
    );
  }

  // Create wizard: notes
  if (mode === 'create-notes') {
    return (
      <Box flexDirection="column">
        {header}
        <Box paddingX={1} flexDirection="column">
          <Text bold>Create Person</Text>
          <Text>Name:  {createName}</Text>
          {createEmail && <Text>Email: {createEmail}</Text>}
          {createPhone && <Text>Phone: {createPhone}</Text>}
          {createRole && <Text>Role:  {createRole}</Text>}
          <Text>{' '}</Text>
          <Box>
            <Text>Notes: </Text>
            <TextInput
              value={createNotes}
              onChange={setCreateNotes}
              onSubmit={() => setMode('create-confirm')}
              focus
              placeholder="(optional) Any notes about this person"
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
          <Text bold>Confirm Person Creation</Text>
          <Text>{' '}</Text>
          <Text>Name:  {createName}</Text>
          {createEmail && <Text>Email: {createEmail}</Text>}
          {createPhone && <Text>Phone: {createPhone}</Text>}
          {createRole && <Text>Role:  {createRole}</Text>}
          {createNotes && <Text>Notes: {createNotes}</Text>}
          <Text>{' '}</Text>
          <Text>Press 'y' to create, 'n' to cancel.</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {header}
      <Text color="gray">Loading...</Text>
    </Box>
  );
}
