import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text } from 'ink';
import { useSafeInput as useInput } from '../hooks/useSafeInput';

const MAX_VISIBLE_ITEMS = 5;

type ViewMode = 'list' | 'detail' | 'delete-confirm' | 'archive-confirm';

export interface WorkspaceEntry {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  participants: string[];
  status: 'active' | 'archived';
}

interface WorkspacePanelProps {
  workspaces: WorkspaceEntry[];
  activeWorkspaceId?: string | null;
  onArchive: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onSelect: (id: string | null) => Promise<void> | void;
  onClose: () => void;
  error?: string | null;
}

function getVisibleRange(
  selectedIndex: number,
  totalItems: number,
  maxVisible: number = MAX_VISIBLE_ITEMS
): { start: number; end: number; hasMore: { above: number; below: number } } {
  if (totalItems <= maxVisible) {
    return { start: 0, end: totalItems, hasMore: { above: 0, below: 0 } };
  }
  const halfWindow = Math.floor(maxVisible / 2);
  let start = selectedIndex - halfWindow;
  let end = selectedIndex + (maxVisible - halfWindow);
  if (start < 0) { start = 0; end = maxVisible; }
  if (end > totalItems) { end = totalItems; start = Math.max(0, totalItems - maxVisible); }
  return { start, end, hasMore: { above: start, below: totalItems - end } };
}

function formatRelativeTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffMin < 1) return 'now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

export function WorkspacePanel({
  workspaces,
  activeWorkspaceId,
  onArchive,
  onDelete,
  onSelect,
  onClose,
  error,
}: WorkspacePanelProps) {
  const [mode, setMode] = useState<ViewMode>('list');
  const [wsIndex, setWsIndex] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceEntry | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<WorkspaceEntry | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    setWsIndex((prev) => Math.min(prev, Math.max(0, workspaces.length - 1)));
  }, [workspaces.length]);

  const wsRange = useMemo(
    () => getVisibleRange(wsIndex, workspaces.length),
    [wsIndex, workspaces.length]
  );

  const currentWs = workspaces[wsIndex];

  useEffect(() => {
    if (mode === 'detail' && !currentWs) {
      setMode('list');
    }
  }, [mode, currentWs]);

  useEffect(() => {
    if (mode === 'delete-confirm' && !deleteTarget) {
      setMode('list');
    }
    if (mode === 'archive-confirm' && !archiveTarget) {
      setMode('list');
    }
  }, [mode, deleteTarget, archiveTarget]);

  const handleArchive = async () => {
    if (!archiveTarget) return;
    setIsProcessing(true);
    try {
      await onArchive(archiveTarget.id);
      setMode('list');
      setArchiveTarget(null);
      setStatusMessage('Workspace archived.');
      setTimeout(() => setStatusMessage(null), 2000);
    } catch (err) {
      setStatusMessage(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsProcessing(true);
    try {
      await onDelete(deleteTarget.id);
      setMode('list');
      setDeleteTarget(null);
      setStatusMessage('Workspace deleted.');
      // After deletion, the parent will re-render with one fewer workspace.
      // Adjust index proactively based on the count that will result.
      const newLength = workspaces.length - 1;
      if (wsIndex >= newLength && wsIndex > 0) {
        setWsIndex(wsIndex - 1);
      }
      setTimeout(() => setStatusMessage(null), 2000);
    } catch (err) {
      setStatusMessage(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSelect = async (workspace: WorkspaceEntry) => {
    if (activeWorkspaceId === workspace.id) {
      setStatusMessage('Workspace already active.');
      setTimeout(() => setStatusMessage(null), 2000);
      return;
    }
    setIsProcessing(true);
    try {
      await onSelect(workspace.id);
      setStatusMessage('Workspace switched.');
      setTimeout(() => setStatusMessage(null), 2000);
    } catch (err) {
      setStatusMessage(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsProcessing(false);
    }
  };

  useInput((input, key) => {
    if (isProcessing) return;

    if (input === 'q' || (key.escape && mode === 'list')) {
      onClose();
      return;
    }

    if (key.escape) {
      if (mode === 'detail') { setMode('list'); }
      else if (mode === 'delete-confirm') { setMode('detail'); setDeleteTarget(null); }
      else if (mode === 'archive-confirm') { setMode('detail'); setArchiveTarget(null); }
      return;
    }

    if (mode === 'list') {
      if (workspaces.length === 0) {
        return;
      }
      if (key.upArrow) {
        setWsIndex((prev) => (prev === 0 ? workspaces.length - 1 : prev - 1));
        return;
      }
      if (key.downArrow) {
        setWsIndex((prev) => (prev === workspaces.length - 1 ? 0 : prev + 1));
        return;
      }
      if ((input === 'u' || input === 'U') && currentWs) {
        void handleSelect(currentWs);
        return;
      }
      if (key.return && currentWs) {
        setMode('detail');
        return;
      }
      const num = parseInt(input, 10);
      if (!isNaN(num) && num >= 1 && num <= workspaces.length) {
        setWsIndex(num - 1);
      }
      return;
    }

    if (mode === 'detail') {
      if ((input === 'u' || input === 'U') && currentWs) {
        void handleSelect(currentWs);
        return;
      }
      if (input === 'a' && currentWs?.status === 'active') {
        setArchiveTarget(currentWs);
        setMode('archive-confirm');
        return;
      }
      if (input === 'x' || key.delete) {
        if (currentWs) {
          setDeleteTarget(currentWs);
          setMode('delete-confirm');
        }
        return;
      }
      return;
    }

    if (mode === 'delete-confirm') {
      if (input === 'y') { handleDelete(); return; }
      if (input === 'n') { setMode('detail'); setDeleteTarget(null); return; }
    }

    if (mode === 'archive-confirm') {
      if (input === 'y') { handleArchive(); return; }
      if (input === 'n') { setMode('detail'); setArchiveTarget(null); return; }
    }
  });

  // Empty state
  if (workspaces.length === 0 && mode === 'list') {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">Workspaces</Text>
        </Box>
        <Box flexDirection="column" borderStyle="round" borderColor="#d4d4d8" borderLeft={false} borderRight={false} paddingX={1} paddingY={1}>
          <Text dimColor>No workspaces found.</Text>
          <Text dimColor>Use /workspace create &lt;name&gt; to create one.</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>q quit</Text>
        </Box>
      </Box>
    );
  }

  // Delete confirmation
  if (mode === 'delete-confirm' && deleteTarget) {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color="red">Delete Workspace</Text>
        </Box>
        <Box flexDirection="column" borderStyle="round" borderColor="#d4d4d8" borderLeft={false} borderRight={false} paddingX={1} paddingY={1}>
          <Text>Are you sure you want to delete this workspace?</Text>
          <Text dimColor>Name: {deleteTarget.name}</Text>
          <Text dimColor>ID: {deleteTarget.id}</Text>
          <Text dimColor>This will remove all workspace files permanently.</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>y confirm | n cancel</Text>
        </Box>
      </Box>
    );
  }

  // Archive confirmation
  if (mode === 'archive-confirm' && archiveTarget) {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color="yellow">Archive Workspace</Text>
        </Box>
        <Box flexDirection="column" borderStyle="round" borderColor="#d4d4d8" borderLeft={false} borderRight={false} paddingX={1} paddingY={1}>
          <Text>Archive this workspace?</Text>
          <Text dimColor>Name: {archiveTarget.name}</Text>
          <Text dimColor>ID: {archiveTarget.id}</Text>
          <Text dimColor>Archived workspaces are hidden from the default list.</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>y confirm | n cancel</Text>
        </Box>
      </Box>
    );
  }

  // Detail view
  if (mode === 'detail' && currentWs) {
    const isActive = currentWs.id === activeWorkspaceId;
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">Workspace: {currentWs.name}</Text>
          <Text color={currentWs.status === 'active' ? 'green' : 'gray'}> [{currentWs.status}]</Text>
          {isActive && <Text color="green"> [current]</Text>}
        </Box>

        <Box flexDirection="column" borderStyle="round" borderColor="#d4d4d8" borderLeft={false} borderRight={false} paddingX={1} paddingY={1}>
          <Box>
            <Text dimColor>ID: </Text>
            <Text>{currentWs.id}</Text>
          </Box>

          {currentWs.description && (
            <Box>
              <Text dimColor>Description: </Text>
              <Text>{currentWs.description}</Text>
            </Box>
          )}

          <Box>
            <Text dimColor>Created by: </Text>
            <Text>{currentWs.createdBy}</Text>
          </Box>

          <Box>
            <Text dimColor>Created: </Text>
            <Text>{formatRelativeTime(currentWs.createdAt)}</Text>
            <Text dimColor> ({new Date(currentWs.createdAt).toLocaleString()})</Text>
          </Box>

          <Box>
            <Text dimColor>Updated: </Text>
            <Text>{formatRelativeTime(currentWs.updatedAt)}</Text>
          </Box>

          <Box marginTop={1} flexDirection="column">
            <Text dimColor>Participants ({currentWs.participants.length}):</Text>
            {currentWs.participants.map((p, i) => (
              <Text key={i}>  - {p}</Text>
            ))}
          </Box>
        </Box>

        {(error || statusMessage) && (
          <Box marginTop={1}>
            <Text color={error || statusMessage?.startsWith('Error') ? 'red' : 'green'}>
              {error || statusMessage}
            </Text>
          </Box>
        )}

        <Box marginTop={1}>
          <Text dimColor>
            u use | {currentWs.status === 'active' ? 'a archive | ' : ''}x delete | Esc back
          </Text>
        </Box>
      </Box>
    );
  }

  // List view
  const visibleWorkspaces = workspaces.slice(wsRange.start, wsRange.end);

  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">Workspaces</Text>
        {workspaces.length > MAX_VISIBLE_ITEMS && (
          <Text dimColor> ({wsIndex + 1}/{workspaces.length})</Text>
        )}
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor="#d4d4d8" borderLeft={false} borderRight={false} paddingX={1}>
        {wsRange.hasMore.above > 0 && (
          <Box paddingY={0}>
            <Text dimColor>  ↑ {wsRange.hasMore.above} more above</Text>
          </Box>
        )}

        {visibleWorkspaces.map((ws, visibleIdx) => {
          const actualIdx = wsRange.start + visibleIdx;
          const isSelected = actualIdx === wsIndex;
          const isActive = ws.id === activeWorkspaceId;
          const prefix = isSelected ? '> ' : '  ';
          const statusIcon = ws.status === 'active' ? '🟢' : '📦';
          const name = ws.name.slice(0, 20).padEnd(20);
          const participants = `${ws.participants.length} participants`.padEnd(16);

          return (
            <Box key={ws.id} paddingY={0}>
              <Text inverse={isSelected} dimColor={!isSelected}>
                {prefix}{statusIcon}{' '}
              </Text>
              <Text inverse={isSelected} bold={isSelected}>
                {name}
              </Text>
              <Text inverse={isSelected} color={isActive ? 'green' : undefined}>
                {isActive ? ' •' : '  '}
              </Text>
              <Text inverse={isSelected} dimColor>
                {' '}{participants}
              </Text>
              <Text inverse={isSelected} dimColor>
                {' '}{formatRelativeTime(ws.updatedAt)}
              </Text>
            </Box>
          );
        })}

        {wsRange.hasMore.below > 0 && (
          <Box paddingY={0}>
            <Text dimColor>  ↓ {wsRange.hasMore.below} more below</Text>
          </Box>
        )}
      </Box>

      {statusMessage && (
        <Box marginTop={1}>
          <Text color={statusMessage.startsWith('Error') ? 'red' : 'green'}>{statusMessage}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>
          ↑↓ select | Enter view | u use | q quit
        </Text>
      </Box>
    </Box>
  );
}
