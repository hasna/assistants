import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import type { ProjectRecord, ProjectPlan, ProjectPlanStep, PlanStepStatus } from '@hasna/assistants-core';
import { useSafeInput as useInput } from '../hooks/useSafeInput';

interface PlansPanelProps {
  project: ProjectRecord;
  onCreatePlan: (title: string) => Promise<void>;
  onDeletePlan: (planId: string) => Promise<void>;
  onAddStep: (planId: string, text: string) => Promise<void>;
  onUpdateStep: (planId: string, stepId: string, status: PlanStepStatus) => Promise<void>;
  onRemoveStep: (planId: string, stepId: string) => Promise<void>;
  onBack: () => void;
  onClose: () => void;
}

type Mode = 'plans' | 'steps' | 'create-plan' | 'delete-plan-confirm' | 'add-step' | 'delete-step-confirm';

const STATUS_ICONS: Record<PlanStepStatus, string> = {
  todo: ' ',
  doing: '~',
  done: '*',
  blocked: '!',
};

const STATUS_COLORS: Record<PlanStepStatus, string | undefined> = {
  todo: undefined,
  doing: 'yellow',
  done: 'green',
  blocked: 'red',
};

const STATUS_CYCLE: PlanStepStatus[] = ['todo', 'doing', 'done', 'blocked'];

function getNextStatus(current: PlanStepStatus): PlanStepStatus {
  const index = STATUS_CYCLE.indexOf(current);
  return STATUS_CYCLE[(index + 1) % STATUS_CYCLE.length];
}

/**
 * Format date for plan display
 */
function formatPlanTime(timestamp: number): string {
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

export function PlansPanel({
  project,
  onCreatePlan,
  onDeletePlan,
  onAddStep,
  onUpdateStep,
  onRemoveStep,
  onBack,
  onClose,
}: PlansPanelProps) {
  const [planIndex, setPlanIndex] = useState(0);
  const [stepIndex, setStepIndex] = useState(0);
  const [mode, setMode] = useState<Mode>('plans');
  const [newPlanTitle, setNewPlanTitle] = useState('');
  const [newStepText, setNewStepText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const plans = project.plans;
  const currentPlan = plans[planIndex] as ProjectPlan | undefined;
  const currentSteps = currentPlan?.steps || [];

  useEffect(() => {
    setPlanIndex((prev) => Math.min(prev, Math.max(0, plans.length - 1)));
  }, [plans.length]);

  useEffect(() => {
    setStepIndex((prev) => Math.min(prev, Math.max(0, currentSteps.length)));
  }, [currentSteps.length]);

  useEffect(() => {
    if (!currentPlan) {
      if (mode !== 'plans') {
        setMode('plans');
        setStepIndex(0);
      }
      return;
    }
    if (mode === 'delete-plan-confirm' && !currentPlan) {
      setMode('plans');
    }
  }, [mode, currentPlan]);

  useEffect(() => {
    if (mode === 'delete-step-confirm' && currentSteps.length === 0) {
      setMode('steps');
    }
  }, [mode, currentSteps.length]);

  useInput((input, key) => {
    // Handle text input modes
    if (mode === 'create-plan' || mode === 'add-step') {
      if (key.escape) {
        setMode(mode === 'add-step' ? 'steps' : 'plans');
        setNewPlanTitle('');
        setNewStepText('');
      }
      return;
    }

    // Delete confirmations
    if (mode === 'delete-plan-confirm') {
      if (input === 'y' || input === 'Y') {
        if (currentPlan) {
          setIsSubmitting(true);
          onDeletePlan(currentPlan.id).finally(() => {
            setIsSubmitting(false);
            setMode('plans');
          });
        }
        return;
      }
      if (input === 'n' || input === 'N' || key.escape) {
        setMode('plans');
        return;
      }
      return;
    }

    if (mode === 'delete-step-confirm') {
      if (input === 'y' || input === 'Y') {
        const step = currentSteps[stepIndex];
        if (currentPlan && step) {
          setIsSubmitting(true);
          onRemoveStep(currentPlan.id, step.id).finally(() => {
            setIsSubmitting(false);
            setMode('steps');
          });
        }
        return;
      }
      if (input === 'n' || input === 'N' || key.escape) {
        setMode('steps');
        return;
      }
      return;
    }

    // Navigation in plans list
    if (mode === 'plans') {
      if (input === 'n' || input === 'N') {
        setMode('create-plan');
        return;
      }

      if (input === 'd' || input === 'D') {
        if (plans.length > 0) {
          setMode('delete-plan-confirm');
        }
        return;
      }

      if (key.escape || input === 'q' || input === 'Q') {
        onBack();
        return;
      }

      if (key.return) {
        if (planIndex === plans.length) {
          setMode('create-plan');
        } else if (currentPlan) {
          setMode('steps');
          setStepIndex(0);
        }
        return;
      }

      if (key.upArrow) {
        setPlanIndex((prev) => (prev === 0 ? plans.length : prev - 1));
        return;
      }

      if (key.downArrow) {
        setPlanIndex((prev) => (prev === plans.length ? 0 : prev + 1));
        return;
      }

      const num = parseInt(input, 10);
      if (!isNaN(num) && num >= 1 && num <= plans.length) {
        setPlanIndex(num - 1);
        return;
      }
    }

    // Navigation in steps list
    if (mode === 'steps') {
      if (input === 'a' || input === 'A') {
        setMode('add-step');
        return;
      }

      if (input === 'd' || input === 'D') {
        if (currentSteps.length > 0 && stepIndex < currentSteps.length) {
          setMode('delete-step-confirm');
        }
        return;
      }

      // Space or Enter to toggle status
      if ((input === ' ' || key.return) && stepIndex < currentSteps.length) {
        const step = currentSteps[stepIndex];
        if (currentPlan && step) {
          const nextStatus = getNextStatus(step.status);
          onUpdateStep(currentPlan.id, step.id, nextStatus);
        }
        return;
      }

      if (key.escape) {
        setMode('plans');
        return;
      }

      if (key.upArrow) {
        setStepIndex((prev) => (prev === 0 ? currentSteps.length : prev - 1));
        return;
      }

      if (key.downArrow) {
        setStepIndex((prev) => (prev === currentSteps.length ? 0 : prev + 1));
        return;
      }

      const num = parseInt(input, 10);
      if (!isNaN(num) && num >= 1 && num <= currentSteps.length) {
        setStepIndex(num - 1);
        return;
      }
    }
  }, { isActive: mode !== 'create-plan' && mode !== 'add-step' });

  const handleCreatePlan = async () => {
    if (!newPlanTitle.trim()) return;
    setIsSubmitting(true);
    try {
      await onCreatePlan(newPlanTitle.trim());
      setNewPlanTitle('');
      setMode('plans');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddStep = async () => {
    if (!newStepText.trim() || !currentPlan) return;
    setIsSubmitting(true);
    try {
      await onAddStep(currentPlan.id, newStepText.trim());
      setNewStepText('');
      setMode('steps');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Create plan mode
  if (mode === 'create-plan') {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">Create New Plan</Text>
        </Box>
        <Box>
          <Text>Title: </Text>
          <TextInput
            value={newPlanTitle}
            onChange={setNewPlanTitle}
            onSubmit={handleCreatePlan}
            focus
            placeholder="Enter plan title..."
          />
        </Box>
        {isSubmitting && (
          <Box marginTop={1}>
            <Text color="yellow">Creating plan...</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <Text dimColor>Enter to create | Esc to cancel</Text>
        </Box>
      </Box>
    );
  }

  // Delete plan confirmation
  if (mode === 'delete-plan-confirm') {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color="red">Delete Plan</Text>
        </Box>
        <Box marginBottom={1}>
          <Text>
            Are you sure you want to delete &quot;{currentPlan?.title}&quot;?
          </Text>
        </Box>
        <Box>
          <Text dimColor>This will delete all {currentSteps.length} steps.</Text>
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

  // Add step mode
  if (mode === 'add-step') {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">Add Step to &quot;{currentPlan?.title}&quot;</Text>
        </Box>
        <Box>
          <Text>Step: </Text>
          <TextInput
            value={newStepText}
            onChange={setNewStepText}
            onSubmit={handleAddStep}
            focus
            placeholder="Enter step description..."
          />
        </Box>
        {isSubmitting && (
          <Box marginTop={1}>
            <Text color="yellow">Adding step...</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <Text dimColor>Enter to add | Esc to cancel</Text>
        </Box>
      </Box>
    );
  }

  // Delete step confirmation
  if (mode === 'delete-step-confirm') {
    const step = currentSteps[stepIndex];
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color="red">Delete Step</Text>
        </Box>
        <Box marginBottom={1}>
          <Text>
            Remove: &quot;{step?.text}&quot;?
          </Text>
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

  // Steps view
  if (mode === 'steps' && currentPlan) {
    const doneCount = currentSteps.filter((s) => s.status === 'done').length;
    const totalCount = currentSteps.length;

    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1} justifyContent="space-between">
          <Text bold>{currentPlan.title}</Text>
          <Text dimColor>[a]dd  [d]elete</Text>
        </Box>

        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="#d4d4d8" borderLeft={false} borderRight={false}
          paddingX={1}
        >
          {currentSteps.length === 0 ? (
            <Box paddingY={1}>
              <Text dimColor>No steps yet. Press a to add one.</Text>
            </Box>
          ) : (
            currentSteps.map((step, index) => {
              const isSelected = index === stepIndex;
              const icon = STATUS_ICONS[step.status];
              const color = STATUS_COLORS[step.status];

              return (
                <Box key={step.id} paddingY={0}>
                  <Text
                    inverse={isSelected}
                    color={color}
                    dimColor={!isSelected && step.status === 'done'}
                  >
                    [{icon}] {index + 1}. {step.text}
                  </Text>
                </Box>
              );
            })
          )}

          {/* Add step option */}
          <Box marginTop={1} paddingY={0}>
            <Text
              inverse={stepIndex === currentSteps.length}
              dimColor={stepIndex !== currentSteps.length}
              color={stepIndex === currentSteps.length ? 'cyan' : undefined}
            >
              + Add step (a)
            </Text>
          </Box>
        </Box>

        <Box marginTop={1}>
          <Text dimColor>
            Progress: {doneCount}/{totalCount} ({totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0}%)
          </Text>
        </Box>

        <Box marginTop={1}>
          <Text dimColor>
            Space/Enter toggle | Esc back | 1-{Math.max(1, currentSteps.length)} jump
          </Text>
        </Box>
      </Box>
    );
  }

  // Plans list view
  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1} justifyContent="space-between">
        <Text bold>Plans for &quot;{project.name}&quot;</Text>
        <Text dimColor>[n]ew</Text>
      </Box>

      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="#d4d4d8" borderLeft={false} borderRight={false}
        paddingX={1}
      >
        {plans.length === 0 ? (
          <Box paddingY={1}>
            <Text dimColor>No plans yet. Press n to create one.</Text>
          </Box>
        ) : (
          plans.map((plan, index) => {
            const isSelected = index === planIndex;
            const doneCount = plan.steps.filter((s) => s.status === 'done').length;
            const totalCount = plan.steps.length;
            const time = formatPlanTime(plan.updatedAt);

            return (
              <Box key={plan.id} paddingY={0}>
                <Text
                  inverse={isSelected}
                  dimColor={!isSelected}
                >
                  {index + 1}. {plan.title.padEnd(25)} [{doneCount}/{totalCount}] {time}
                </Text>
              </Box>
            );
          })
        )}

        {/* New plan option */}
        <Box marginTop={1} paddingY={0}>
          <Text
            inverse={planIndex === plans.length}
            dimColor={planIndex !== plans.length}
            color={planIndex === plans.length ? 'cyan' : undefined}
          >
            + New plan (n)
          </Text>
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          Enter view | d delete | Esc back | 1-{Math.max(1, plans.length)} jump
        </Text>
      </Box>
    </Box>
  );
}
