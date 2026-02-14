import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import type { Task, TaskPriority, TaskStatus, TaskCreateOptions } from '@hasna/assistants-core';
import { useSafeInput as useInput } from '../hooks/useSafeInput';

interface TasksPanelProps {
  tasks: Task[];
  paused: boolean;
  onAdd: (options: TaskCreateOptions) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onRun: (id: string) => Promise<void>;
  onClearPending: () => Promise<void>;
  onClearCompleted: () => Promise<void>;
  onTogglePause: () => Promise<void>;
  onChangePriority: (id: string, priority: TaskPriority) => Promise<void>;
  onClose: () => void;
}

type Mode = 'list' | 'create' | 'delete-confirm' | 'priority-select';
type CreateField = 'description' | 'priority' | 'blockedBy' | 'blocks' | 'assignee';

const STATUS_ICONS: Record<TaskStatus, string> = {
  pending: '○',
  in_progress: '◐',
  completed: '●',
  failed: '✗',
};

const STATUS_COLORS: Record<TaskStatus, string | undefined> = {
  pending: undefined,
  in_progress: 'yellow',
  completed: 'green',
  failed: 'red',
};

const PRIORITY_ICONS: Record<TaskPriority, string> = {
  high: '↑',
  normal: '-',
  low: '↓',
};

const PRIORITY_COLORS: Record<TaskPriority, string | undefined> = {
  high: 'red',
  normal: undefined,
  low: 'gray',
};

/**
 * Format date for task display
 */
function formatTaskTime(timestamp: number): string {
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

export function TasksPanel({
  tasks,
  paused,
  onAdd,
  onDelete,
  onRun,
  onClearPending,
  onClearCompleted,
  onTogglePause,
  onChangePriority,
  onClose,
}: TasksPanelProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mode, setMode] = useState<Mode>('list');
  const [newDescription, setNewDescription] = useState('');
  const [newPriority, setNewPriority] = useState<TaskPriority>('normal');
  const [newBlockedBy, setNewBlockedBy] = useState<string[]>([]);
  const [newBlocks, setNewBlocks] = useState<string[]>([]);
  const [newAssignee, setNewAssignee] = useState('');
  const [createField, setCreateField] = useState<CreateField>('description');
  const [blockedByIndex, setBlockedByIndex] = useState(0);
  const [blocksIndex, setBlocksIndex] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Get pending/in_progress tasks that can be selected as blockers
  const selectableTasks = tasks.filter((t) => t.status === 'pending' || t.status === 'in_progress');

  useEffect(() => {
    setSelectedIndex((prev) => Math.min(prev, Math.max(0, tasks.length)));
  }, [tasks.length]);

  useEffect(() => {
    if ((mode === 'delete-confirm' || mode === 'priority-select') && (tasks.length === 0 || selectedIndex >= tasks.length)) {
      setMode('list');
    }
  }, [mode, tasks.length, selectedIndex]);

  useInput((input, key) => {
    // In create mode, handle navigation between fields
    if (mode === 'create') {
      if (key.escape) {
        setMode('list');
        setNewDescription('');
        setNewPriority('normal');
        setNewBlockedBy([]);
        setNewBlocks([]);
        setNewAssignee('');
        setCreateField('description');
        return;
      }

      // Tab to move to next field
      if (key.tab && !key.shift) {
        const fields: CreateField[] = ['description', 'priority', 'blockedBy', 'blocks', 'assignee'];
        const currentIndex = fields.indexOf(createField);
        const nextIndex = (currentIndex + 1) % fields.length;
        setCreateField(fields[nextIndex]);
        return;
      }

      // Shift+Tab to move to previous field
      if (key.tab && key.shift) {
        const fields: CreateField[] = ['description', 'priority', 'blockedBy', 'blocks', 'assignee'];
        const currentIndex = fields.indexOf(createField);
        const prevIndex = currentIndex === 0 ? fields.length - 1 : currentIndex - 1;
        setCreateField(fields[prevIndex]);
        return;
      }

      // Handle priority field
      if (createField === 'priority') {
        if (key.leftArrow || input === 'h') {
          setNewPriority((prev) => (prev === 'low' ? 'high' : prev === 'high' ? 'normal' : 'low'));
        } else if (key.rightArrow || input === 'l') {
          setNewPriority((prev) => (prev === 'high' ? 'low' : prev === 'low' ? 'normal' : 'high'));
        }
        return;
      }

      // Handle blockedBy field - select tasks to be blocked by
      if (createField === 'blockedBy') {
        if (selectableTasks.length > 0) {
          if (key.upArrow) {
            setBlockedByIndex((prev) => (prev === 0 ? selectableTasks.length - 1 : prev - 1));
          } else if (key.downArrow) {
            setBlockedByIndex((prev) => (prev === selectableTasks.length - 1 ? 0 : prev + 1));
          } else if (input === ' ' || key.return) {
            // Toggle selection
            const taskId = selectableTasks[blockedByIndex]?.id;
            if (taskId) {
              setNewBlockedBy((prev) =>
                prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId]
              );
            }
          }
        }
        return;
      }

      // Handle blocks field - select tasks that this task blocks
      if (createField === 'blocks') {
        if (selectableTasks.length > 0) {
          if (key.upArrow) {
            setBlocksIndex((prev) => (prev === 0 ? selectableTasks.length - 1 : prev - 1));
          } else if (key.downArrow) {
            setBlocksIndex((prev) => (prev === selectableTasks.length - 1 ? 0 : prev + 1));
          } else if (input === ' ' || key.return) {
            // Toggle selection
            const taskId = selectableTasks[blocksIndex]?.id;
            if (taskId) {
              setNewBlocks((prev) =>
                prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId]
              );
            }
          }
        }
        return;
      }

      // Text input handled by TextInput component for description and assignee
      return;
    }

    // In delete confirmation mode
    if (mode === 'delete-confirm') {
      if (input === 'y' || input === 'Y') {
        const task = tasks[selectedIndex];
        if (task) {
          setIsSubmitting(true);
          onDelete(task.id).finally(() => {
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

    // In priority select mode
    if (mode === 'priority-select') {
      const task = tasks[selectedIndex];
      if (input === 'h' || input === 'H') {
        if (task) {
          setIsSubmitting(true);
          onChangePriority(task.id, 'high').finally(() => {
            setIsSubmitting(false);
            setMode('list');
          });
        }
        return;
      }
      if (input === 'n' || input === 'N') {
        if (task) {
          setIsSubmitting(true);
          onChangePriority(task.id, 'normal').finally(() => {
            setIsSubmitting(false);
            setMode('list');
          });
        }
        return;
      }
      if (input === 'l' || input === 'L') {
        if (task) {
          setIsSubmitting(true);
          onChangePriority(task.id, 'low').finally(() => {
            setIsSubmitting(false);
            setMode('list');
          });
        }
        return;
      }
      if (key.escape) {
        setMode('list');
        return;
      }
      return;
    }

    // List mode shortcuts
    // n: new task
    if (input === 'n' || input === 'N') {
      setMode('create');
      return;
    }

    // d: delete selected task
    if (input === 'd' || input === 'D') {
      if (tasks.length > 0 && selectedIndex < tasks.length) {
        setMode('delete-confirm');
      }
      return;
    }

    // p: change priority of selected task
    if (input === 'p' || input === 'P') {
      if (tasks.length > 0 && selectedIndex < tasks.length) {
        setMode('priority-select');
      }
      return;
    }

    // r: run selected task
    if (input === 'r' || input === 'R') {
      const task = tasks[selectedIndex];
      if (task && task.status === 'pending') {
        setIsSubmitting(true);
        onRun(task.id).finally(() => {
          setIsSubmitting(false);
          onClose();
        });
      }
      return;
    }

    // Space: toggle pause
    if (input === ' ') {
      setIsSubmitting(true);
      onTogglePause().finally(() => {
        setIsSubmitting(false);
      });
      return;
    }

    // c: clear completed
    if (input === 'c' || input === 'C') {
      setIsSubmitting(true);
      onClearCompleted().finally(() => {
        setIsSubmitting(false);
      });
      return;
    }

    // Escape or q: close panel
    if (key.escape || input === 'q' || input === 'Q') {
      onClose();
      return;
    }

    // Enter: run selected task (if pending)
    if (key.return) {
      if (selectedIndex === tasks.length) {
        // "New task" option
        setMode('create');
      } else {
        const task = tasks[selectedIndex];
        if (task && task.status === 'pending') {
          setIsSubmitting(true);
          onRun(task.id).finally(() => {
            setIsSubmitting(false);
            onClose();
          });
        }
      }
      return;
    }

    // Arrow navigation with wraparound
    if (key.upArrow) {
      setSelectedIndex((prev) => (prev === 0 ? tasks.length : prev - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex((prev) => (prev === tasks.length ? 0 : prev + 1));
      return;
    }

    // Number keys for quick selection (1-9)
    const num = parseInt(input, 10);
    if (!isNaN(num) && num >= 1 && num <= tasks.length) {
      setSelectedIndex(num - 1);
      return;
    }
  }, { isActive: mode !== 'create' });

  const handleCreateSubmit = async () => {
    if (!newDescription.trim()) return;
    setIsSubmitting(true);
    try {
      await onAdd({
        description: newDescription.trim(),
        priority: newPriority,
        blockedBy: newBlockedBy.length > 0 ? newBlockedBy : undefined,
        blocks: newBlocks.length > 0 ? newBlocks : undefined,
        assignee: newAssignee.trim() || undefined,
      });
      setNewDescription('');
      setNewPriority('normal');
      setNewBlockedBy([]);
      setNewBlocks([]);
      setNewAssignee('');
      setCreateField('description');
      setMode('list');
    } finally {
      setIsSubmitting(false);
    }
  };

  const getTaskLabel = (taskId: string): string => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return taskId;
    const desc = task.description.slice(0, 30) + (task.description.length > 30 ? '...' : '');
    return desc;
  };

  // Create mode UI
  if (mode === 'create') {
    const isFieldActive = (field: CreateField) => createField === field;

    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">Add New Task</Text>
        </Box>

        <Box flexDirection="column" borderStyle="round" borderColor="#d4d4d8" borderLeft={false} borderRight={false} paddingX={1} paddingY={0}>
          {/* Description field */}
          <Box>
            <Text inverse={isFieldActive('description')} color={isFieldActive('description') ? 'cyan' : undefined}>
              Task:{' '}
            </Text>
            {isFieldActive('description') ? (
              <TextInput
                value={newDescription}
                onChange={setNewDescription}
                onSubmit={() => setCreateField('priority')}
                focus
                placeholder="What needs to be done..."
              />
            ) : (
              <Text dimColor={!newDescription}>{newDescription || '(empty)'}</Text>
            )}
          </Box>

          {/* Priority field */}
          <Box marginTop={0}>
            <Text inverse={isFieldActive('priority')} color={isFieldActive('priority') ? 'cyan' : undefined}>
              Priority:{' '}
            </Text>
            <Text color={PRIORITY_COLORS[newPriority]}>
              {PRIORITY_ICONS[newPriority]} {newPriority}
            </Text>
            {isFieldActive('priority') && <Text dimColor> (←/→ to change)</Text>}
          </Box>

          {/* Blocked By field */}
          <Box marginTop={0} flexDirection="column">
            <Box>
              <Text inverse={isFieldActive('blockedBy')} color={isFieldActive('blockedBy') ? 'cyan' : undefined}>
                Blocked by:{' '}
              </Text>
              {newBlockedBy.length > 0 ? (
                <Text>{newBlockedBy.map((id) => getTaskLabel(id)).join(', ')}</Text>
              ) : (
                <Text dimColor>(none)</Text>
              )}
            </Box>
            {isFieldActive('blockedBy') && selectableTasks.length > 0 && (
              <Box flexDirection="column" marginLeft={2}>
                {selectableTasks.map((task, idx) => {
                  const isSelected = newBlockedBy.includes(task.id);
                  const isCursor = idx === blockedByIndex;
                  const desc = task.description.slice(0, 35) + (task.description.length > 35 ? '...' : '');
                  return (
                    <Text key={task.id} inverse={isCursor}>
                      {isSelected ? '[x]' : '[ ]'} {desc}
                    </Text>
                  );
                })}
                <Text dimColor>↑/↓ navigate, Space to toggle</Text>
              </Box>
            )}
            {isFieldActive('blockedBy') && selectableTasks.length === 0 && (
              <Box marginLeft={2}><Text dimColor>No tasks available to select</Text></Box>
            )}
          </Box>

          {/* Blocks field */}
          <Box marginTop={0} flexDirection="column">
            <Box>
              <Text inverse={isFieldActive('blocks')} color={isFieldActive('blocks') ? 'cyan' : undefined}>
                Blocks:{' '}
              </Text>
              {newBlocks.length > 0 ? (
                <Text>{newBlocks.map((id) => getTaskLabel(id)).join(', ')}</Text>
              ) : (
                <Text dimColor>(none)</Text>
              )}
            </Box>
            {isFieldActive('blocks') && selectableTasks.length > 0 && (
              <Box flexDirection="column" marginLeft={2}>
                {selectableTasks.map((task, idx) => {
                  const isSelected = newBlocks.includes(task.id);
                  const isCursor = idx === blocksIndex;
                  const desc = task.description.slice(0, 35) + (task.description.length > 35 ? '...' : '');
                  return (
                    <Text key={task.id} inverse={isCursor}>
                      {isSelected ? '[x]' : '[ ]'} {desc}
                    </Text>
                  );
                })}
                <Text dimColor>↑/↓ navigate, Space to toggle</Text>
              </Box>
            )}
            {isFieldActive('blocks') && selectableTasks.length === 0 && (
              <Box marginLeft={2}><Text dimColor>No tasks available to select</Text></Box>
            )}
          </Box>

          {/* Assignee field */}
          <Box marginTop={0}>
            <Text inverse={isFieldActive('assignee')} color={isFieldActive('assignee') ? 'cyan' : undefined}>
              Assignee:{' '}
            </Text>
            {isFieldActive('assignee') ? (
              <TextInput
                value={newAssignee}
                onChange={setNewAssignee}
                onSubmit={handleCreateSubmit}
                focus
                placeholder="assistant name or leave empty"
              />
            ) : (
              <Text dimColor={!newAssignee}>{newAssignee || '(unassigned)'}</Text>
            )}
          </Box>

          {/* Submit button hint */}
          <Box marginTop={1}>
            <Text dimColor>
              {createField === 'assignee'
                ? 'Enter: save task | Tab: cycle fields | Esc: cancel'
                : 'Enter: next field | Tab: cycle fields | Esc: cancel'}
            </Text>
          </Box>
        </Box>

        {isSubmitting && (
          <Box marginTop={1}>
            <Text color="yellow">Adding task...</Text>
          </Box>
        )}
      </Box>
    );
  }

  // Delete confirmation mode
  if (mode === 'delete-confirm') {
    const task = tasks[selectedIndex];
    if (!task) {
      setMode('list');
      return null;
    }
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color="red">Delete Task</Text>
        </Box>
        <Box marginBottom={1}>
          <Text>
            Delete task: &quot;{task.description.slice(0, 50)}{task.description.length > 50 ? '...' : ''}&quot;?
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

  // Priority select mode
  if (mode === 'priority-select') {
    const task = tasks[selectedIndex];
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">Change Priority</Text>
        </Box>
        <Box marginBottom={1}>
          <Text>Task: {task?.description.slice(0, 50)}{(task?.description.length || 0) > 50 ? '...' : ''}</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text>
            <Text color="red" bold>h</Text> High priority
          </Text>
          <Text>
            <Text bold>n</Text> Normal priority
          </Text>
          <Text>
            <Text color="gray" bold>l</Text> Low priority
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Press letter to select | Esc to cancel</Text>
        </Box>
      </Box>
    );
  }

  // Count tasks by status
  const pendingCount = tasks.filter((t) => t.status === 'pending').length;
  const inProgressCount = tasks.filter((t) => t.status === 'in_progress').length;
  const completedCount = tasks.filter((t) => t.status === 'completed').length;
  const failedCount = tasks.filter((t) => t.status === 'failed').length;

  // List mode UI
  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1} justifyContent="space-between">
        <Box>
          <Text bold>Tasks </Text>
          <Text color={paused ? 'yellow' : 'green'}>
            {paused ? '(Paused)' : '(Active)'}
          </Text>
        </Box>
        <Text dimColor>[n]ew [Space]pause</Text>
      </Box>

      {/* Status summary */}
      <Box marginBottom={1}>
        <Text dimColor>
          {pendingCount} pending, {inProgressCount} running, {completedCount} done, {failedCount} failed
        </Text>
      </Box>

      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="#d4d4d8" borderLeft={false} borderRight={false}
        paddingX={1}
      >
        {tasks.length === 0 ? (
          <Box paddingY={1}>
            <Text dimColor>No tasks yet. Press n to add one.</Text>
          </Box>
        ) : (
          tasks.map((task, index) => {
            const isSelected = index === selectedIndex;
            const statusIcon = STATUS_ICONS[task.status];
            const statusColor = STATUS_COLORS[task.status];
            const priorityIcon = PRIORITY_ICONS[task.priority];
            const priorityColor = PRIORITY_COLORS[task.priority];
            const time = formatTaskTime(task.createdAt);
            const desc = task.description.slice(0, 40) + (task.description.length > 40 ? '...' : '');

            return (
              <Box key={task.id} paddingY={0}>
                <Text inverse={isSelected} dimColor={!isSelected && task.status === 'completed'}>
                  <Text color={statusColor}>{statusIcon}</Text>
                  {' '}
                  <Text color={priorityColor}>[{priorityIcon}]</Text>
                  {' '}
                  {index + 1}. {desc.padEnd(42)} {time}
                </Text>
              </Box>
            );
          })
        )}

        {/* New task option */}
        <Box marginTop={1} paddingY={0}>
          <Text
            inverse={selectedIndex === tasks.length}
            dimColor={selectedIndex !== tasks.length}
            color={selectedIndex === tasks.length ? 'cyan' : undefined}
          >
            + Add task (n)
          </Text>
        </Box>
      </Box>

      {/* Selected task details */}
      {tasks.length > 0 && selectedIndex < tasks.length && (() => {
        const task = tasks[selectedIndex];
        const formatTime = (ts: number | undefined) => ts ? new Date(ts).toLocaleString() : 'n/a';
        const getElapsed = () => {
          if (task.status !== 'in_progress' || !task.startedAt) return null;
          const elapsed = Date.now() - task.startedAt;
          const secs = Math.floor(elapsed / 1000);
          const mins = Math.floor(secs / 60);
          const hrs = Math.floor(mins / 60);
          if (hrs > 0) return `${hrs}h ${mins % 60}m elapsed`;
          if (mins > 0) return `${mins}m ${secs % 60}s elapsed`;
          return `${secs}s elapsed`;
        };
        const elapsed = getElapsed();

        return (
          <Box marginTop={1} flexDirection="column" borderStyle="round" borderColor="#d4d4d8" borderLeft={false} borderRight={false} paddingX={1}>
            <Text bold wrap="wrap">{task.description}</Text>

            {/* Timestamps and elapsed time */}
            <Box marginTop={0}>
              <Text dimColor>Created: {formatTime(task.createdAt)}</Text>
              {elapsed && <Text color="yellow"> | {elapsed}</Text>}
            </Box>
            {task.startedAt && (
              <Text dimColor>Started: {formatTime(task.startedAt)}</Text>
            )}
            {task.completedAt && (
              <Text dimColor>Completed: {formatTime(task.completedAt)}</Text>
            )}

            {/* Dependencies and assignment */}
            {task.blockedBy && task.blockedBy.length > 0 && (
              <Text dimColor>Blocked by: {task.blockedBy.map(id => getTaskLabel(id)).join(', ')}</Text>
            )}
            {task.blocks && task.blocks.length > 0 && (
              <Text dimColor>Blocks: {task.blocks.map(id => getTaskLabel(id)).join(', ')}</Text>
            )}
            {task.assignee && (
              <Text dimColor>Assignee: {task.assignee}</Text>
            )}
            {task.projectId && (
              <Text dimColor>Project: {task.projectId}</Text>
            )}

            {/* Result/Error */}
            {task.error && (
              <Text color="red">Error: {task.error}</Text>
            )}
            {task.result && (
              <Text color="green">Result: {task.result}</Text>
            )}
          </Box>
        );
      })()}

      <Box marginTop={1}>
        <Text dimColor>
          Enter/r run | p priority | d delete | c clear done | Esc close
        </Text>
      </Box>
    </Box>
  );
}
