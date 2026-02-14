import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import type { ProjectRecord } from '@hasna/assistants-core';
import { useSafeInput as useInput } from '../hooks/useSafeInput';

interface ProjectsPanelProps {
  projects: ProjectRecord[];
  activeProjectId?: string;
  onSelect: (projectId: string) => void;
  onCreate: (name: string, description?: string) => Promise<void>;
  onDelete: (projectId: string) => Promise<void>;
  onViewPlans: (projectId: string) => void;
  onCancel: () => void;
}

/**
 * Format date for project display
 */
function formatProjectTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  if (isToday) {
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).toLowerCase();
  }

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  }).toLowerCase();
}

type Mode = 'list' | 'create' | 'delete-confirm';

export function ProjectsPanel({
  projects,
  activeProjectId,
  onSelect,
  onCreate,
  onDelete,
  onViewPlans,
  onCancel,
}: ProjectsPanelProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mode, setMode] = useState<Mode>('list');
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [createStep, setCreateStep] = useState<'name' | 'description'>('name');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setSelectedIndex((prev) => Math.min(prev, projects.length));
  }, [projects.length]);

  useEffect(() => {
    if (mode === 'delete-confirm' && (!projects[selectedIndex] || projects.length === 0)) {
      setMode('list');
    }
  }, [mode, projects, selectedIndex]);

  useInput((input, key) => {
    // In create mode, handle text input
    if (mode === 'create') {
      if (key.escape) {
        setMode('list');
        setNewName('');
        setNewDescription('');
        setCreateStep('name');
        return;
      }
      // Text input handled by TextInput component
      return;
    }

    // In delete confirmation mode
    if (mode === 'delete-confirm') {
      if (input === 'y' || input === 'Y') {
        const project = projects[selectedIndex];
        if (project) {
          setIsSubmitting(true);
          onDelete(project.id).finally(() => {
            setIsSubmitting(false);
            setMode('list');
          });
        }
        return;
      }
      if (input === 'n' || input === 'N' || key.escape) {
        setMode('list');
        return;
      }
      return;
    }

    // List mode shortcuts
    if (input === 'n' || input === 'N') {
      setMode('create');
      setCreateStep('name');
      return;
    }

    if (input === 'd' || input === 'D') {
      if (projects.length > 0 && selectedIndex < projects.length) {
        setMode('delete-confirm');
      }
      return;
    }

    if (input === 'p' || input === 'P') {
      if (projects.length > 0 && selectedIndex < projects.length) {
        onViewPlans(projects[selectedIndex].id);
      }
      return;
    }

    // Escape or q: cancel
    if (key.escape || input === 'q' || input === 'Q') {
      onCancel();
      return;
    }

    // Enter: select/view project
    if (key.return) {
      if (selectedIndex === projects.length) {
        // "New project" option
        setMode('create');
        setCreateStep('name');
      } else {
        onSelect(projects[selectedIndex].id);
      }
      return;
    }

    // Arrow navigation with wraparound
    if (key.upArrow) {
      setSelectedIndex((prev) => (prev === 0 ? projects.length : prev - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex((prev) => (prev === projects.length ? 0 : prev + 1));
      return;
    }

    // Number keys for quick selection (1-9)
    const num = parseInt(input, 10);
    if (!isNaN(num) && num >= 1 && num <= projects.length) {
      setSelectedIndex(num - 1);
      return;
    }
  }, { isActive: mode === 'list' || mode === 'delete-confirm' });

  const handleNameSubmit = () => {
    if (!newName.trim()) return;
    setCreateStep('description');
  };

  const handleDescriptionSubmit = async () => {
    if (!newName.trim()) return;
    setIsSubmitting(true);
    try {
      await onCreate(newName.trim(), newDescription.trim() || undefined);
      setNewName('');
      setNewDescription('');
      setCreateStep('name');
      setMode('list');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSkipDescription = async () => {
    if (!newName.trim()) return;
    setIsSubmitting(true);
    try {
      await onCreate(newName.trim());
      setNewName('');
      setNewDescription('');
      setCreateStep('name');
      setMode('list');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Create mode UI
  if (mode === 'create') {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">Create New Project</Text>
        </Box>

        {createStep === 'name' && (
          <Box flexDirection="column">
            <Box>
              <Text>Name: </Text>
              <TextInput
                value={newName}
                onChange={setNewName}
                onSubmit={handleNameSubmit}
                focus
                placeholder="Enter project name..."
              />
            </Box>
            <Box marginTop={1}>
              <Text dimColor>Enter to continue | Esc to cancel</Text>
            </Box>
          </Box>
        )}

        {createStep === 'description' && (
          <Box flexDirection="column">
            <Box>
              <Text dimColor>Name: </Text>
              <Text>{newName}</Text>
            </Box>
            <Box marginTop={1}>
              <Text>Description: </Text>
              <TextInput
                value={newDescription}
                onChange={setNewDescription}
                onSubmit={handleDescriptionSubmit}
                focus
                placeholder="Enter description (optional)..."
              />
            </Box>
            <Box marginTop={1}>
              <Text dimColor>Enter to create | Tab to skip | Esc to cancel</Text>
            </Box>
          </Box>
        )}

        {isSubmitting && (
          <Box marginTop={1}>
            <Text color="yellow">Creating project...</Text>
          </Box>
        )}
      </Box>
    );
  }

  // Delete confirmation mode
  if (mode === 'delete-confirm') {
    const project = projects[selectedIndex];
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color="red">Delete Project</Text>
        </Box>
        <Box marginBottom={1}>
          <Text>
            Are you sure you want to delete &quot;{project?.name}&quot;?
          </Text>
        </Box>
        <Box>
          <Text dimColor>This will delete all plans in this project.</Text>
        </Box>
        <Box marginTop={1}>
          <Text>
            Press <Text color="green" bold>y</Text> to confirm or{' '}
            <Text color="red" bold>n</Text> to cancel
          </Text>
        </Box>
      </Box>
    );
  }

  // List mode UI
  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1} justifyContent="space-between">
        <Text bold>Projects</Text>
        <Text dimColor>[n]ew</Text>
      </Box>

      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="#d4d4d8" borderLeft={false} borderRight={false}
        paddingX={1}
      >
        {projects.length === 0 ? (
          <Box paddingY={1}>
            <Text dimColor>No projects yet. Press n to create one.</Text>
          </Box>
        ) : (
          projects.map((project, index) => {
            const isActive = project.id === activeProjectId;
            const isSelected = index === selectedIndex;
            const planCount = project.plans.length;
            const contextCount = project.context.length;
            const time = formatProjectTime(project.updatedAt);

            return (
              <Box key={project.id} paddingY={0}>
                <Text
                  inverse={isSelected}
                  color={isActive ? 'green' : undefined}
                  dimColor={!isSelected && !isActive}
                >
                  {isActive ? '*' : ' '} {index + 1}. {project.name.padEnd(20)} {planCount} plan{planCount !== 1 ? 's' : ''} {contextCount > 0 ? `${contextCount} ctx` : ''} {time}
                </Text>
              </Box>
            );
          })
        )}

        {/* New project option */}
        <Box marginTop={1} paddingY={0}>
          <Text
            inverse={selectedIndex === projects.length}
            dimColor={selectedIndex !== projects.length}
            color={selectedIndex === projects.length ? 'cyan' : undefined}
          >
            + New project (n)
          </Text>
        </Box>
      </Box>

      {/* Selected project details */}
      {projects.length > 0 && selectedIndex < projects.length && (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>
            {projects[selectedIndex].description || 'No description'}
          </Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>
          Enter select | p plans | d delete | Esc close | 1-{Math.max(1, projects.length)} jump
        </Text>
      </Box>
    </Box>
  );
}
