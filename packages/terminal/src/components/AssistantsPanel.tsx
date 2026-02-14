import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import type { Assistant, AssistantSettings, CreateAssistantOptions } from '@hasna/assistants-core';
import { useSafeInput as useInput } from '../hooks/useSafeInput';
import {
  ANTHROPIC_MODELS,
  DEFAULT_MODEL,
  DEFAULT_TEMPERATURE,
  MIN_TEMPERATURE,
  MAX_TEMPERATURE,
  TEMPERATURE_STEP,
  getModelDisplayName,
} from '@hasna/assistants-shared';

interface AssistantsPanelProps {
  assistants: Assistant[];
  activeAssistantId?: string;
  onSelect: (assistantId: string) => void;
  onCreate: (options: CreateAssistantOptions) => Promise<void>;
  onUpdate: (id: string, updates: Partial<{ name: string; description: string; settings: Record<string, unknown> }>) => Promise<void>;
  onDelete: (assistantId: string) => Promise<void>;
  onCancel: () => void;
  error?: string | null;
  onClearError?: () => void;
}

/**
 * Format date for assistant display
 */
function formatTime(timestamp: string): string {
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

type Mode = 'list' | 'create' | 'edit' | 'delete-confirm';
type CreateStep = 'name' | 'description' | 'model' | 'temperature' | 'systemPrompt';

function getBackendLabel(backend?: string): string {
  switch (backend) {
    case 'claude-agent-sdk': return 'claude-sdk';
    case 'codex-sdk': return 'codex-sdk';
    case 'native':
    default: return 'native';
  }
}

export function AssistantsPanel({
  assistants,
  activeAssistantId,
  onSelect,
  onCreate,
  onUpdate,
  onDelete,
  onCancel,
  error,
  onClearError,
}: AssistantsPanelProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mode, setMode] = useState<Mode>('list');
  const [createStep, setCreateStep] = useState<CreateStep>('name');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Create form state
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [selectedModelIndex, setSelectedModelIndex] = useState(
    Math.max(0, ANTHROPIC_MODELS.findIndex((m) => m.id === DEFAULT_MODEL))
  );
  const [temperature, setTemperature] = useState(DEFAULT_TEMPERATURE);
  const [newSystemPrompt, setNewSystemPrompt] = useState('');

  // Edit state
  const [editingAssistant, setEditingAssistant] = useState<Assistant | null>(null);
  const [editStep, setEditStep] = useState<CreateStep>('name');

  const sortedAssistants = useMemo(() => {
    const system = assistants.filter((a) => a.isSystem);
    const user = assistants.filter((a) => !a.isSystem);
    return [...system, ...user];
  }, [assistants]);

  // Adjust selected index when assistants change
  useEffect(() => {
    setSelectedIndex((prev) => Math.min(prev, sortedAssistants.length));
  }, [sortedAssistants.length]);

  // Reset form state
  const resetForm = useCallback(() => {
    setNewName('');
    setNewDescription('');
    setSelectedModelIndex(Math.max(0, ANTHROPIC_MODELS.findIndex((m) => m.id === DEFAULT_MODEL)));
    setTemperature(DEFAULT_TEMPERATURE);
    setNewSystemPrompt('');
    setCreateStep('name');
    setEditingAssistant(null);
    setEditStep('name');
  }, []);

  useEffect(() => {
    if (mode === 'delete-confirm' && (sortedAssistants.length === 0 || selectedIndex >= sortedAssistants.length)) {
      setMode('list');
    }
  }, [mode, sortedAssistants.length, selectedIndex]);

  useEffect(() => {
    if (mode !== 'edit') return;
    if (!editingAssistant || !sortedAssistants.some((a) => a.id === editingAssistant.id)) {
      resetForm();
      setMode('list');
    }
  }, [mode, editingAssistant, sortedAssistants, resetForm]);

  // Handle list mode input
  useInput((input, key) => {
    if (mode !== 'list') return;

    // New assistant
    if (input === 'n' || input === 'N') {
      onClearError?.();
      resetForm();
      setMode('create');
      return;
    }

    // Edit assistant
    if (input === 'e' || input === 'E') {
      if (sortedAssistants.length > 0 && selectedIndex < sortedAssistants.length) {
        onClearError?.();
        const assistant = sortedAssistants[selectedIndex];
        setEditingAssistant(assistant);
        setNewName(assistant.name);
        setNewDescription(assistant.description || '');
        const modelIdx = ANTHROPIC_MODELS.findIndex((m) => m.id === assistant.settings.model);
        setSelectedModelIndex(
          modelIdx >= 0 ? modelIdx : Math.max(0, ANTHROPIC_MODELS.findIndex((m) => m.id === DEFAULT_MODEL))
        );
        setTemperature(assistant.settings.temperature ?? DEFAULT_TEMPERATURE);
        setNewSystemPrompt(assistant.settings.systemPromptAddition || '');
        setEditStep('name');
        setMode('edit');
      }
      return;
    }

    // Delete assistant
    if (input === 'd' || input === 'D') {
      if (sortedAssistants.length > 0 && selectedIndex < sortedAssistants.length) {
        const assistant = sortedAssistants[selectedIndex];
        if (assistant.isSystem) {
          return; // Cannot delete system assistants
        }
        onClearError?.();
        setMode('delete-confirm');
      }
      return;
    }

    // Escape or q: cancel
    if (key.escape || input === 'q' || input === 'Q') {
      onClearError?.();
      onCancel();
      return;
    }

    // Enter: select/switch assistant
    if (key.return) {
      onClearError?.();
      if (selectedIndex === sortedAssistants.length) {
        // "New assistant" option
        resetForm();
        setMode('create');
      } else {
        onSelect(sortedAssistants[selectedIndex].id);
      }
      return;
    }

    // Arrow navigation with wraparound
    if (key.upArrow) {
      setSelectedIndex((prev) => (prev === 0 ? sortedAssistants.length : prev - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex((prev) => (prev === sortedAssistants.length ? 0 : prev + 1));
      return;
    }

    // Number keys for quick selection (1-9)
    const num = parseInt(input, 10);
    if (!isNaN(num) && num >= 1 && num <= sortedAssistants.length) {
      setSelectedIndex(num - 1);
      return;
    }
  }, { isActive: mode === 'list' });

  // Handle delete confirmation input
  useInput((input, key) => {
    if (mode !== 'delete-confirm') return;

    if (input === 'y' || input === 'Y') {
      const assistant = sortedAssistants[selectedIndex];
      if (assistant) {
        setIsSubmitting(true);
        onDelete(assistant.id).finally(() => {
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
  }, { isActive: mode === 'delete-confirm' });

  // Handle create/edit mode escape
  useInput((_input, key) => {
    if (mode !== 'create' && mode !== 'edit') return;
    const step = mode === 'create' ? createStep : editStep;
    if (step === 'name') return;

    if (key.escape) {
      if (mode === 'create') {
        if (createStep === 'description') setCreateStep('name');
        else if (createStep === 'model') setCreateStep('description');
        else if (createStep === 'temperature') setCreateStep('model');
        else if (createStep === 'systemPrompt') setCreateStep('temperature');
      } else {
        if (editStep === 'description') setEditStep('name');
        else if (editStep === 'model') setEditStep('description');
        else if (editStep === 'temperature') setEditStep('model');
        else if (editStep === 'systemPrompt') setEditStep('temperature');
      }
    }
  }, { isActive: mode === 'create' || mode === 'edit' });

  // Handle create/edit tab skips
  useInput((_input, key) => {
    if (mode !== 'create' && mode !== 'edit') return;
    if (!key.tab || key.shift) return;
    const step = mode === 'create' ? createStep : editStep;

    if (step === 'description') {
      handleSkipDescription();
      return;
    }
    if (step === 'systemPrompt') {
      handleSkipSystemPrompt();
    }
  }, { isActive: mode === 'create' || mode === 'edit' });

  // Handle model selection input
  useInput((input, key) => {
    const isCreateModelStep = mode === 'create' && createStep === 'model';
    const isEditModelStep = mode === 'edit' && editStep === 'model';
    if (!isCreateModelStep && !isEditModelStep) return;

    if (key.upArrow) {
      setSelectedModelIndex((prev) => (prev === 0 ? ANTHROPIC_MODELS.length - 1 : prev - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedModelIndex((prev) => (prev === ANTHROPIC_MODELS.length - 1 ? 0 : prev + 1));
      return;
    }

    if (key.return) {
      if (mode === 'create') {
        setCreateStep('temperature');
      } else {
        setEditStep('temperature');
      }
      return;
    }

    if (key.escape) {
      if (mode === 'create') {
        setCreateStep('description');
      } else {
        setEditStep('description');
      }
      return;
    }
  }, { isActive: (mode === 'create' && createStep === 'model') || (mode === 'edit' && editStep === 'model') });

  // Handle temperature input
  useInput((input, key) => {
    const isCreateTempStep = mode === 'create' && createStep === 'temperature';
    const isEditTempStep = mode === 'edit' && editStep === 'temperature';
    if (!isCreateTempStep && !isEditTempStep) return;

    if (key.leftArrow) {
      setTemperature((prev) => Math.max(MIN_TEMPERATURE, parseFloat((prev - TEMPERATURE_STEP).toFixed(1))));
      return;
    }

    if (key.rightArrow) {
      setTemperature((prev) => Math.min(MAX_TEMPERATURE, parseFloat((prev + TEMPERATURE_STEP).toFixed(1))));
      return;
    }

    if (key.return) {
      if (mode === 'create') {
        setCreateStep('systemPrompt');
      } else {
        setEditStep('systemPrompt');
      }
      return;
    }

    if (key.escape) {
      if (mode === 'create') {
        setCreateStep('model');
      } else {
        setEditStep('model');
      }
      return;
    }
  }, { isActive: (mode === 'create' && createStep === 'temperature') || (mode === 'edit' && editStep === 'temperature') });

  // Handle system prompt step escape
  useInput((_input, key) => {
    const isCreateSystemPromptStep = mode === 'create' && createStep === 'systemPrompt';
    const isEditSystemPromptStep = mode === 'edit' && editStep === 'systemPrompt';
    if (!isCreateSystemPromptStep && !isEditSystemPromptStep) return;

    if (key.escape) {
      if (mode === 'create') {
        setCreateStep('temperature');
      } else {
        setEditStep('temperature');
      }
    }
  }, { isActive: (mode === 'create' && createStep === 'systemPrompt') || (mode === 'edit' && editStep === 'systemPrompt') });

  // Handle name step escape (full cancel)
  useInput((_input, key) => {
    const isCreateNameStep = mode === 'create' && createStep === 'name';
    const isEditNameStep = mode === 'edit' && editStep === 'name';
    if (!isCreateNameStep && !isEditNameStep) return;

    if (key.escape) {
      resetForm();
      setMode('list');
    }
  }, { isActive: (mode === 'create' && createStep === 'name') || (mode === 'edit' && editStep === 'name') });

  // Form submission handlers
  const handleNameSubmit = () => {
    if (!newName.trim()) return;
    if (mode === 'create') {
      setCreateStep('description');
    } else {
      setEditStep('description');
    }
  };

  const handleDescriptionSubmit = () => {
    if (mode === 'create') {
      setCreateStep('model');
    } else {
      setEditStep('model');
    }
  };

  const handleSkipDescription = () => {
    setNewDescription('');
    if (mode === 'create') {
      setCreateStep('model');
    } else {
      setEditStep('model');
    }
  };

  const handleSystemPromptSubmit = () => {
    if (mode === 'create') {
      handleCreate();
    } else {
      handleUpdate();
    }
  };

  const handleSkipSystemPrompt = () => {
    setNewSystemPrompt('');
    if (mode === 'create') {
      handleCreate();
    } else {
      handleUpdate();
    }
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setIsSubmitting(true);
    try {
      const settings: Partial<AssistantSettings> = {
        model: ANTHROPIC_MODELS[selectedModelIndex].id,
        temperature,
        systemPromptAddition: newSystemPrompt.trim() || undefined,
      };
      await onCreate({
        name: newName.trim(),
        description: newDescription.trim() || undefined,
        settings,
      });
      resetForm();
      setMode('list');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdate = async () => {
    if (!editingAssistant || !newName.trim()) return;
    setIsSubmitting(true);
    try {
      await onUpdate(editingAssistant.id, {
        name: newName.trim(),
        description: newDescription.trim() || undefined,
        settings: {
          ...editingAssistant.settings,
          model: ANTHROPIC_MODELS[selectedModelIndex].id,
          temperature,
          systemPromptAddition: newSystemPrompt.trim() || undefined,
        } as Record<string, unknown>,
      });
      resetForm();
      setMode('list');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Render model selection
  const renderModelSelection = () => (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="cyan">{mode === 'create' ? 'Create New Assistant' : 'Edit Assistant'}</Text>
        <Text dimColor> - Model</Text>
      </Box>

      <Box marginBottom={1} flexDirection="column">
        <Text dimColor>Name: {newName}</Text>
        {newDescription && <Text dimColor>Description: {newDescription}</Text>}
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor="#d4d4d8" borderLeft={false} borderRight={false} paddingX={1}>
        {ANTHROPIC_MODELS.map((model, index) => (
          <Box key={model.id} paddingY={0}>
            <Text
              inverse={index === selectedModelIndex}
              color={index === selectedModelIndex ? 'cyan' : undefined}
              dimColor={index !== selectedModelIndex}
            >
              {index === selectedModelIndex ? '>' : ' '} {model.name}
              <Text dimColor> - {model.description}</Text>
            </Text>
          </Box>
        ))}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Up/Down select | Enter continue | Esc back</Text>
      </Box>
    </Box>
  );

  // Render temperature slider
  const renderTemperatureSlider = () => {
    const sliderWidth = 20;
    const filledWidth = Math.round((temperature / MAX_TEMPERATURE) * sliderWidth);
    const emptyWidth = sliderWidth - filledWidth;
    const slider = '[' + '='.repeat(filledWidth) + ' '.repeat(emptyWidth) + ']';

    return (
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text bold color="cyan">{mode === 'create' ? 'Create New Assistant' : 'Edit Assistant'}</Text>
          <Text dimColor> - Temperature</Text>
        </Box>

        <Box marginBottom={1} flexDirection="column">
          <Text dimColor>Name: {newName}</Text>
          {newDescription && <Text dimColor>Description: {newDescription}</Text>}
          <Text dimColor>Model: {ANTHROPIC_MODELS[selectedModelIndex].name}</Text>
        </Box>

        <Box>
          <Text>Temperature: </Text>
          <Text color="cyan">{temperature.toFixed(1)}</Text>
          <Text dimColor> {slider}</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>
            {temperature < 0.5 ? 'More deterministic' : temperature > 1.5 ? 'More creative' : 'Balanced'}
          </Text>
        </Box>

        <Box marginTop={1}>
          <Text dimColor>Left/Right adjust | Enter continue | Esc back</Text>
        </Box>

        {isSubmitting && (
          <Box marginTop={1}>
            <Text color="yellow">{mode === 'create' ? 'Creating...' : 'Saving...'}</Text>
          </Box>
        )}
      </Box>
    );
  };

  // Create/Edit mode UI
  if (mode === 'create' || mode === 'edit') {
    const currentStep = mode === 'create' ? createStep : editStep;

    if (currentStep === 'model') {
      return (
        <Box flexDirection="column" paddingY={1}>
          {renderModelSelection()}
        </Box>
      );
    }

    if (currentStep === 'temperature') {
      return (
        <Box flexDirection="column" paddingY={1}>
          {renderTemperatureSlider()}
        </Box>
      );
    }

    if (currentStep === 'systemPrompt') {
      return (
        <Box flexDirection="column" paddingY={1}>
          <Box marginBottom={1}>
            <Text bold color="cyan">{mode === 'create' ? 'Create New Assistant' : 'Edit Assistant'}</Text>
            <Text dimColor> - Custom Instructions</Text>
          </Box>

          <Box marginBottom={1} flexDirection="column">
            <Text dimColor>Name: {newName}</Text>
            {newDescription && <Text dimColor>Description: {newDescription}</Text>}
            <Text dimColor>Model: {ANTHROPIC_MODELS[selectedModelIndex].name}</Text>
            <Text dimColor>Temperature: {temperature.toFixed(1)}</Text>
          </Box>

          <Box>
            <Text>Instructions: </Text>
            <TextInput
              value={newSystemPrompt}
              onChange={setNewSystemPrompt}
              onSubmit={handleSystemPromptSubmit}
              focus
              placeholder="Custom system prompt (optional)..."
            />
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Enter to {mode === 'create' ? 'create' : 'save'} | Tab to skip | Esc back</Text>
          </Box>

          {isSubmitting && (
            <Box marginTop={1}>
              <Text color="yellow">{mode === 'create' ? 'Creating assistant...' : 'Updating assistant...'}</Text>
            </Box>
          )}
        </Box>
      );
    }

    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">{mode === 'create' ? 'Create New Assistant' : 'Edit Assistant'}</Text>
        </Box>

        {currentStep === 'name' && (
          <Box flexDirection="column">
            <Box>
              <Text>Name: </Text>
              <TextInput
                value={newName}
                onChange={setNewName}
                onSubmit={handleNameSubmit}
                focus
                placeholder="Enter assistant name..."
              />
            </Box>
            <Box marginTop={1}>
              <Text dimColor>Enter to continue | Esc to cancel</Text>
            </Box>
          </Box>
        )}

        {currentStep === 'description' && (
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
              <Text dimColor>Enter to continue | Tab to skip | Esc to go back</Text>
            </Box>
          </Box>
        )}

        {isSubmitting && (
          <Box marginTop={1}>
            <Text color="yellow">{mode === 'create' ? 'Creating assistant...' : 'Updating assistant...'}</Text>
          </Box>
        )}
      </Box>
    );
  }

  // Delete confirmation mode
  if (mode === 'delete-confirm') {
    const assistant = sortedAssistants[selectedIndex];
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color="red">Delete Assistant</Text>
        </Box>
        <Box marginBottom={1}>
          <Text>
            Are you sure you want to delete &quot;{assistant?.name}&quot;?
          </Text>
        </Box>
        <Box>
          <Text dimColor>This action cannot be undone.</Text>
        </Box>
        <Box marginTop={1}>
          <Text>
            Press <Text color="green" bold>y</Text> to confirm or{' '}
            <Text color="red" bold>n</Text> to cancel
          </Text>
        </Box>
        {isSubmitting && (
          <Box marginTop={1}>
            <Text color="yellow">Deleting...</Text>
          </Box>
        )}
      </Box>
    );
  }

  // List mode UI
  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1} justifyContent="space-between">
        <Text bold>Assistants</Text>
        <Text dimColor>[n]ew [e]dit [d]elete</Text>
      </Box>

      {error && (
        <Box marginBottom={1}>
          <Text color="red">Error: {error}</Text>
        </Box>
      )}

      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="#d4d4d8" borderLeft={false} borderRight={false}
        paddingX={1}
      >
        {sortedAssistants.length === 0 ? (
          <Box paddingY={1}>
            <Text dimColor>No assistants yet. Press n to create one.</Text>
          </Box>
        ) : (
          sortedAssistants.map((assistant, index) => {
            const isActive = assistant.id === activeAssistantId;
            const isSelected = index === selectedIndex;
            const modelName = getModelDisplayName(assistant.settings.model);
            const temp = assistant.settings.temperature?.toFixed(1) ?? DEFAULT_TEMPERATURE.toFixed(1);
            const time = formatTime(assistant.updatedAt);
            const backendLabel = getBackendLabel(assistant.settings.backend);
            const systemBadge = assistant.isSystem ? '[system] ' : '';

            return (
              <Box key={assistant.id} paddingY={0}>
                <Text
                  inverse={isSelected}
                  color={isActive ? 'green' : undefined}
                  dimColor={!isSelected && !isActive}
                >
                  {isActive ? '*' : ' '} {index + 1}. {systemBadge}{assistant.name.padEnd(16)} {modelName.padEnd(18)} {backendLabel.padEnd(10)} T:{temp} {time}
                </Text>
              </Box>
            );
          })
        )}

        {/* New assistant option */}
        <Box marginTop={1} paddingY={0}>
          <Text
            inverse={selectedIndex === sortedAssistants.length}
            dimColor={selectedIndex !== sortedAssistants.length}
            color={selectedIndex === sortedAssistants.length ? 'cyan' : undefined}
          >
            + New assistant (n)
          </Text>
        </Box>
      </Box>

      {/* Selected assistant details */}
      {sortedAssistants.length > 0 && selectedIndex < sortedAssistants.length && (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>
            {sortedAssistants[selectedIndex].description || 'No description'}
          </Text>
          {sortedAssistants[selectedIndex].settings.systemPromptAddition && (
            <Text dimColor>
              System prompt: {sortedAssistants[selectedIndex].settings.systemPromptAddition.slice(0, 50)}
              {(sortedAssistants[selectedIndex].settings.systemPromptAddition?.length || 0) > 50 ? '...' : ''}
            </Text>
          )}
          {sortedAssistants[selectedIndex].isSystem && (
            <Text dimColor color="yellow">
              System assistant — cannot be deleted
            </Text>
          )}
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>
          Enter select | e edit | d delete | Esc close | 1-{Math.max(1, sortedAssistants.length)} jump
        </Text>
      </Box>
    </Box>
  );
}
