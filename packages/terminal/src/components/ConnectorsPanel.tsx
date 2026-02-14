import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import type { Connector, ConnectorCommand, ConnectorStatus } from '@hasna/assistants-shared';
import { ConnectorAutoRefreshManager } from '@hasna/assistants-core';
import type { ConnectorAutoRefreshEntry, ConnectorAutoRefreshSchedule } from '@hasna/assistants-core';
import { useSafeInput as useInput } from '../hooks/useSafeInput';

type ViewMode = 'list' | 'detail' | 'command';

// Maximum visible items in lists before pagination kicks in
const MAX_VISIBLE_ITEMS = 10;

/**
 * Simple fuzzy match function
 * Returns true if all characters in the query appear in order in the text
 */
function fuzzyMatch(text: string, query: string): boolean {
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();

  let textIdx = 0;
  for (const char of lowerQuery) {
    const foundIdx = lowerText.indexOf(char, textIdx);
    if (foundIdx === -1) return false;
    textIdx = foundIdx + 1;
  }
  return true;
}

/**
 * Score a connector based on search query
 * Higher score = better match
 * Returns 0 if no match
 */
function scoreConnector(connector: Connector, query: string): number {
  if (!query) return 1; // No query = show all

  const lowerQuery = query.toLowerCase();
  let score = 0;

  // Exact name match
  if (connector.name.toLowerCase() === lowerQuery) {
    score += 100;
  }
  // Name starts with query
  else if (connector.name.toLowerCase().startsWith(lowerQuery)) {
    score += 50;
  }
  // Name contains query
  else if (connector.name.toLowerCase().includes(lowerQuery)) {
    score += 30;
  }
  // Fuzzy name match
  else if (fuzzyMatch(connector.name, query)) {
    score += 10;
  }

  // Description contains query
  if (connector.description?.toLowerCase().includes(lowerQuery)) {
    score += 20;
  }

  // Command names match
  if (connector.commands) {
    for (const cmd of connector.commands) {
      if (cmd.name.toLowerCase().includes(lowerQuery)) {
        score += 15;
        break;
      }
      if (cmd.description?.toLowerCase().includes(lowerQuery)) {
        score += 5;
      }
    }
  }

  return score;
}

/**
 * Calculate the visible window range for paginated lists
 * Keeps the selected item centered when possible
 */
function getVisibleRange(
  selectedIndex: number,
  totalItems: number,
  maxVisible: number = MAX_VISIBLE_ITEMS
): { start: number; end: number; hasMore: { above: number; below: number } } {
  if (totalItems <= maxVisible) {
    return {
      start: 0,
      end: totalItems,
      hasMore: { above: 0, below: 0 },
    };
  }

  // Try to center the selected item
  const halfWindow = Math.floor(maxVisible / 2);
  let start = selectedIndex - halfWindow;
  let end = selectedIndex + (maxVisible - halfWindow);

  // Adjust if we're near the beginning
  if (start < 0) {
    start = 0;
    end = maxVisible;
  }

  // Adjust if we're near the end
  if (end > totalItems) {
    end = totalItems;
    start = Math.max(0, totalItems - maxVisible);
  }

  return {
    start,
    end,
    hasMore: {
      above: start,
      below: totalItems - end,
    },
  };
}

function formatAutoRefreshSchedule(schedule?: ConnectorAutoRefreshSchedule | null): string {
  if (!schedule) return '';
  if (schedule.kind === 'cron') {
    return schedule.timezone
      ? `cron ${schedule.cron} (${schedule.timezone})`
      : `cron ${schedule.cron}`;
  }
  const unit = schedule.unit || 'minutes';
  return `every ${schedule.interval} ${unit}`;
}

interface ConnectorsPanelProps {
  connectors: Connector[];
  /** Initial connector name to jump to (from /connectors <name>) */
  initialConnector?: string;
  /** Callback to check auth status for a connector */
  onCheckAuth: (connector: Connector) => Promise<ConnectorStatus>;
  /** Callback to get detailed command info (runs <cli> <command> --help) */
  onGetCommandHelp?: (connector: Connector, command: string) => Promise<string>;
  /** Callback to load full connector commands (runs full discovery) */
  onLoadCommands?: (connectorName: string) => Promise<Connector | null>;
  /** Close the panel */
  onClose: () => void;
}

/**
 * Interactive panel for browsing connectors, commands, and parameters
 */
export function ConnectorsPanel({
  connectors,
  initialConnector,
  onCheckAuth,
  onGetCommandHelp,
  onLoadCommands,
  onClose,
}: ConnectorsPanelProps) {
  const [mode, setMode] = useState<ViewMode>('list');
  const [connectorIndex, setConnectorIndex] = useState(0);
  const [commandIndex, setCommandIndex] = useState(0);
  const [authStatuses, setAuthStatuses] = useState<Map<string, ConnectorStatus>>(new Map());
  const [commandHelp, setCommandHelp] = useState<string | null>(null);
  const [isLoadingHelp, setIsLoadingHelp] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [loadingConnectorName, setLoadingConnectorName] = useState<string | null>(null);
  const [loadedConnectors, setLoadedConnectors] = useState<Map<string, Connector>>(new Map());
  const [autoRefreshEntries, setAutoRefreshEntries] = useState<Map<string, ConnectorAutoRefreshEntry>>(new Map());
  const [autoRefreshError, setAutoRefreshError] = useState<string | null>(null);
  const pendingAuthChecksRef = useRef<Set<string>>(new Set());

  // Filter and sort connectors based on search query
  const filteredConnectors = useMemo(() => {
    if (!searchQuery.trim()) {
      return connectors;
    }

    const scored = connectors
      .map((connector) => ({
        connector,
        score: scoreConnector(connector, searchQuery),
      }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score);

    return scored.map(({ connector }) => connector);
  }, [connectors, searchQuery]);

  // Reset index when filtered results change
  useEffect(() => {
    setConnectorIndex(0);
  }, [searchQuery]);

  // Clamp connector index to valid range (prevents out-of-bounds before useEffect fires)
  const safeConnectorIndex = filteredConnectors.length > 0
    ? Math.min(connectorIndex, filteredConnectors.length - 1)
    : 0;

  // Jump to initial connector if specified
  useEffect(() => {
    if (initialConnector) {
      const idx = filteredConnectors.findIndex(
        (c) => c.name.toLowerCase() === initialConnector.toLowerCase()
      );
      if (idx !== -1) {
        setConnectorIndex(idx);
        setMode('detail');
      }
    }
  }, [initialConnector, filteredConnectors]);

  const loadAutoRefreshEntries = useCallback(async () => {
    try {
      const manager = ConnectorAutoRefreshManager.getInstance();
      await manager.start();
      const entries = manager.list();
      setAutoRefreshEntries(new Map(entries.map((entry) => [entry.connector, entry])));
      setAutoRefreshError(null);
    } catch (err) {
      setAutoRefreshError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    loadAutoRefreshEntries();
  }, [loadAutoRefreshEntries, connectors.length]);

  const toggleAutoRefresh = useCallback(async (connectorName: string) => {
    try {
      const manager = ConnectorAutoRefreshManager.getInstance();
      await manager.start();
      const existing = manager.get(connectorName);
      if (!existing || !existing.enabled) {
        await manager.enable(connectorName);
      } else {
        await manager.disable(connectorName);
      }
      const entries = manager.list();
      setAutoRefreshEntries(new Map(entries.map((entry) => [entry.connector, entry])));
      setAutoRefreshError(null);
    } catch (err) {
      setAutoRefreshError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const baseConnector = filteredConnectors[safeConnectorIndex];
  // Use loaded connector if available (has full command list)
  const currentConnector = baseConnector
    ? (loadedConnectors.get(baseConnector.name) || baseConnector)
    : undefined;
  const currentCommands = currentConnector?.commands || [];
  const currentCommand = currentCommands[commandIndex];
  const currentStatus = currentConnector ? authStatuses.get(currentConnector.name) : undefined;
  const autoRefreshEntry = currentConnector
    ? autoRefreshEntries.get(currentConnector.name.toLowerCase())
    : null;

  // Load commands when entering detail view
  const loadConnectorCommands = useCallback(async (connector: Connector) => {
    if (!onLoadCommands) return;
    if (loadedConnectors.has(connector.name)) return;

    // Check if connector only has minimal commands (like just "help")
    const needsLoad = connector.commands.length <= 1 ||
      (connector.commands.length === 1 && connector.commands[0].name === 'help');
    if (!needsLoad) return;

    const connectorName = connector.name;
    setLoadingConnectorName(connectorName);
    try {
      const loaded = await onLoadCommands(connectorName);
      if (loaded) {
        setLoadedConnectors((prev) => new Map(prev).set(connectorName, loaded));
      }
    } catch {
      // Ignore load errors
    } finally {
      // Only clear loading state if we're still loading this connector
      // This prevents race conditions when user switches connectors mid-load
      setLoadingConnectorName((current) => current === connectorName ? null : current);
    }
  }, [onLoadCommands, loadedConnectors]);

  // Load commands when entering detail view
  useEffect(() => {
    if (mode === 'detail' && baseConnector) {
      loadConnectorCommands(baseConnector);
    }
  }, [mode, baseConnector, loadConnectorCommands]);

  useEffect(() => {
    setCommandIndex((prev) => Math.min(prev, Math.max(0, currentCommands.length - 1)));
  }, [currentCommands.length]);

  useEffect(() => {
    if (mode === 'detail' && !currentConnector) {
      setMode('list');
      setCommandIndex(0);
      return;
    }
    if (mode === 'command' && (!currentConnector || !currentCommand)) {
      setMode(currentConnector ? 'detail' : 'list');
      setCommandHelp(null);
    }
  }, [mode, currentConnector, currentCommand]);

  // Load command help when entering command detail view
  const loadCommandHelp = useCallback(async () => {
    if (!currentConnector || !currentCommand || !onGetCommandHelp) {
      setCommandHelp(null);
      return;
    }
    setIsLoadingHelp(true);
    try {
      const help = await onGetCommandHelp(currentConnector, currentCommand.name);
      setCommandHelp(help);
    } catch {
      setCommandHelp(null);
    } finally {
      setIsLoadingHelp(false);
    }
  }, [currentConnector, currentCommand, onGetCommandHelp]);

  useEffect(() => {
    if (mode === 'command') {
      loadCommandHelp();
    } else {
      setCommandHelp(null);
    }
  }, [mode, loadCommandHelp]);

  // Keyboard navigation
  useInput((input, key) => {
    // When in search mode, only handle escape and enter
    if (isSearching) {
      if (input === 'q' || input === 'Q') {
        onClose();
        return;
      }
      if (key.escape) {
        if (searchQuery) {
          setSearchQuery('');
        } else {
          setIsSearching(false);
        }
        return;
      }
      if (key.return && filteredConnectors.length > 0) {
        setIsSearching(false);
        setMode('detail');
        setCommandIndex(0);
        return;
      }
      // Don't process other keys in search mode - TextInput handles them
      return;
    }

    // Start search with / key
    if (input === '/' && mode === 'list') {
      setIsSearching(true);
      return;
    }

    // Exit with q anywhere
    if (input === 'q' || input === 'Q') {
      onClose();
      return;
    }

    // Escape to go back / close
    if (key.escape && mode === 'list') {
      if (searchQuery) {
        setSearchQuery('');
        return;
      }
      onClose();
      return;
    }

    // Escape to go back
    if (key.escape) {
      if (mode === 'command') {
        setMode('detail');
        setCommandHelp(null);
      } else if (mode === 'detail') {
        setMode('list');
        setCommandIndex(0);
      }
      return;
    }

    // Enter to drill down
    if (key.return) {
      if (mode === 'list' && filteredConnectors.length > 0) {
        setMode('detail');
        setCommandIndex(0);
      } else if (mode === 'detail' && currentCommands.length > 0) {
        setMode('command');
      }
      return;
    }

    // Toggle auto-refresh in detail view
    if (mode === 'detail' && currentConnector && input.toLowerCase() === 'a') {
      void toggleAutoRefresh(currentConnector.name);
      return;
    }

    // Arrow navigation
    if (key.upArrow) {
      if (mode === 'list' && filteredConnectors.length > 0) {
        setConnectorIndex((prev) => (prev === 0 ? filteredConnectors.length - 1 : prev - 1));
      } else if (mode === 'detail' && currentCommands.length > 0) {
        setCommandIndex((prev) => (prev === 0 ? currentCommands.length - 1 : prev - 1));
      }
      return;
    }

    if (key.downArrow) {
      if (mode === 'list' && filteredConnectors.length > 0) {
        setConnectorIndex((prev) => (prev === filteredConnectors.length - 1 ? 0 : prev + 1));
      } else if (mode === 'detail' && currentCommands.length > 0) {
        setCommandIndex((prev) => (prev === currentCommands.length - 1 ? 0 : prev + 1));
      }
      return;
    }

    // Number keys for quick selection (only when not searching)
    const num = parseInt(input, 10);
    if (!isNaN(num) && num >= 1) {
      if (mode === 'list' && num <= filteredConnectors.length) {
        setConnectorIndex(num - 1);
      } else if (mode === 'detail' && num <= currentCommands.length) {
        setCommandIndex(num - 1);
      }
      return;
    }
  });

  // Render status icon
  const getStatusIcon = (status?: ConnectorStatus): { icon: string; color: string } => {
    if (!status) return { icon: '?', color: 'gray' };
    if (status.error) return { icon: '?', color: 'gray' };
    if (status.authenticated) return { icon: '✓', color: 'green' };
    return { icon: '○', color: 'yellow' };
  };

  // Calculate visible range for connector list
  const connectorRange = useMemo(
    () => getVisibleRange(safeConnectorIndex, filteredConnectors.length),
    [safeConnectorIndex, filteredConnectors.length]
  );

  // Calculate visible range for commands list
  const commandRange = useMemo(
    () => getVisibleRange(commandIndex, currentCommands.length),
    [commandIndex, currentCommands.length]
  );

  // Get visible connectors
  const visibleConnectors = filteredConnectors.slice(connectorRange.start, connectorRange.end);

  // Load auth status lazily for visible/current connectors to keep navigation responsive.
  useEffect(() => {
    const targets = mode === 'list'
      ? visibleConnectors
      : (currentConnector ? [currentConnector] : []);

    if (targets.length === 0) {
      return;
    }

    let cancelled = false;

    const loadStatuses = async () => {
      for (const connector of targets) {
        const name = connector.name;
        if (authStatuses.has(name) || pendingAuthChecksRef.current.has(name)) {
          continue;
        }

        pendingAuthChecksRef.current.add(name);
        try {
          let status: ConnectorStatus;
          try {
            status = await onCheckAuth(connector);
          } catch {
            status = { authenticated: false, error: 'Failed to check' };
          }
          if (cancelled) continue;
          setAuthStatuses((prev) => {
            if (prev.has(name)) return prev;
            const next = new Map(prev);
            next.set(name, status);
            return next;
          });
        } finally {
          pendingAuthChecksRef.current.delete(name);
        }
      }
    };

    void loadStatuses();

    return () => {
      cancelled = true;
    };
  }, [authStatuses, currentConnector, mode, onCheckAuth, visibleConnectors]);

  // Empty state
  if (connectors.length === 0) {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">Connectors</Text>
        </Box>
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="#d4d4d8" borderLeft={false} borderRight={false}
          paddingX={1}
          paddingY={1}
        >
          <Text dimColor>No connectors found.</Text>
          <Text dimColor>Connectors are auto-discovered from installed `connect-*` CLIs.</Text>
          <Box marginTop={1}>
            <Text dimColor>Install with: `bun add -g connect-&lt;name&gt;`</Text>
          </Box>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>q quit</Text>
        </Box>
      </Box>
    );
  }

  // Command detail view
  if (mode === 'command' && currentConnector && currentCommand) {
    const cli = currentConnector.cli || `connect-${currentConnector.name}`;
    const hasArgs = currentCommand.args && currentCommand.args.length > 0;
    const hasOptions = currentCommand.options && currentCommand.options.length > 0;

    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">
            {currentConnector.name} {'>'} {currentCommand.name}
          </Text>
        </Box>

        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="#d4d4d8" borderLeft={false} borderRight={false}
          paddingX={1}
          paddingY={1}
        >
          <Text>{currentCommand.description || 'No description'}</Text>

          {hasArgs && (
            <Box flexDirection="column" marginTop={1}>
              <Text bold>Arguments:</Text>
              {currentCommand.args.map((arg, idx) => (
                <Box key={idx} marginLeft={2}>
                  <Text color={arg.required ? 'white' : 'gray'}>
                    {arg.name}
                    {arg.required ? ' (required)' : ' (optional)'}
                    {arg.description ? ` - ${arg.description}` : ''}
                  </Text>
                </Box>
              ))}
            </Box>
          )}

          {hasOptions && (
            <Box flexDirection="column" marginTop={1}>
              <Text bold>Options:</Text>
              {currentCommand.options.map((opt, idx) => (
                <Box key={idx} marginLeft={2}>
                  <Text dimColor>
                    --{opt.name}
                    {opt.alias ? `, -${opt.alias}` : ''}
                    {opt.type !== 'boolean' ? ` <${opt.type}>` : ''}
                    {opt.default !== undefined ? ` (default: ${String(opt.default)})` : ''}
                    {opt.description ? ` - ${opt.description}` : ''}
                  </Text>
                </Box>
              ))}
            </Box>
          )}

          {isLoadingHelp && (
            <Box marginTop={1}>
              <Text color="yellow">Loading help...</Text>
            </Box>
          )}

          {commandHelp && !isLoadingHelp && (
            <Box flexDirection="column" marginTop={1}>
              <Text bold>Help output:</Text>
              <Box marginLeft={2} marginTop={1}>
                <Text dimColor>{commandHelp}</Text>
              </Box>
            </Box>
          )}

          <Box flexDirection="column" marginTop={1}>
            <Text bold>Example:</Text>
            <Box marginLeft={2}>
              <Text color="cyan">{cli} {currentCommand.name}</Text>
            </Box>
          </Box>
        </Box>

        <Box marginTop={1}>
          <Text dimColor>Esc back | q quit</Text>
        </Box>
      </Box>
    );
  }

  // Connector detail view
  if (mode === 'detail' && currentConnector) {
    const cli = currentConnector.cli || `connect-${currentConnector.name}`;
    const status = getStatusIcon(currentStatus);
    const autoRefreshColor = autoRefreshEntry
      ? (autoRefreshEntry.enabled ? 'green' : 'yellow')
      : 'gray';
    const autoRefreshStatus = autoRefreshEntry
      ? (autoRefreshEntry.enabled ? 'enabled' : 'disabled')
      : 'not configured';
    const autoRefreshSchedule = autoRefreshEntry
      ? formatAutoRefreshSchedule(autoRefreshEntry.schedule)
      : '';

    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">{currentConnector.name}</Text>
        </Box>

        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="#d4d4d8" borderLeft={false} borderRight={false}
          paddingX={1}
        >
          <Box paddingY={1} flexDirection="column">
            <Box>
              <Text>Status: </Text>
              <Text color={status.color}>{status.icon}</Text>
              <Text> </Text>
              <Text color={status.color}>
                {currentStatus?.authenticated
                  ? 'Authenticated'
                  : currentStatus?.error || 'Not authenticated'}
              </Text>
            </Box>
            {currentStatus?.user && (
              <Box>
                <Text dimColor>Account: {currentStatus.user}</Text>
              </Box>
            )}
            {currentStatus?.email && !currentStatus?.user && (
              <Box>
                <Text dimColor>Account: {currentStatus.email}</Text>
              </Box>
            )}
            <Box>
              <Text dimColor>CLI: {cli}</Text>
            </Box>
            <Box>
              <Text dimColor>Auto-refresh: </Text>
              <Text color={autoRefreshColor}>{autoRefreshStatus}</Text>
              {autoRefreshSchedule && (
                <Text dimColor> ({autoRefreshSchedule})</Text>
              )}
            </Box>
            {autoRefreshEntry?.nextRunAt && (
              <Box>
                <Text dimColor>
                  Next refresh: {new Date(autoRefreshEntry.nextRunAt).toLocaleString()}
                </Text>
              </Box>
            )}
            {autoRefreshError && (
              <Box>
                <Text color="red">Auto-refresh error: {autoRefreshError}</Text>
              </Box>
            )}
          </Box>

          <Box marginTop={1} marginBottom={1}>
            <Text bold>Commands:</Text>
            {currentCommands.length > MAX_VISIBLE_ITEMS && (
              <Text dimColor> ({commandIndex + 1}/{currentCommands.length})</Text>
            )}
          </Box>

          {loadingConnectorName === currentConnector.name ? (
            <Box paddingBottom={1}>
              <Text color="yellow">Loading commands...</Text>
            </Box>
          ) : currentCommands.length === 0 ? (
            <Box paddingBottom={1}>
              <Text dimColor>No commands discovered</Text>
            </Box>
          ) : (
            <>
              {commandRange.hasMore.above > 0 && (
                <Box paddingY={0}>
                  <Text dimColor>  ↑ {commandRange.hasMore.above} more above</Text>
                </Box>
              )}

              {currentCommands.slice(commandRange.start, commandRange.end).map((cmd, visibleIdx) => {
                const actualIdx = commandRange.start + visibleIdx;
                const isSelected = actualIdx === commandIndex;
                const prefix = isSelected ? '> ' : '  ';
                const displayName = cmd.name.padEnd(20);

                return (
                  <Box key={cmd.name} paddingY={0}>
                    <Text
                      inverse={isSelected}
                      dimColor={!isSelected}
                    >
                      {prefix}{actualIdx + 1}. {displayName} {cmd.description}
                    </Text>
                  </Box>
                );
              })}

              {commandRange.hasMore.below > 0 && (
                <Box paddingY={0}>
                  <Text dimColor>  ↓ {commandRange.hasMore.below} more below</Text>
                </Box>
              )}
            </>
          )}
        </Box>

        <Box marginTop={1}>
          <Text dimColor>
            ↑↓ navigate | Enter view command | a auto-refresh | Esc back | q quit
          </Text>
        </Box>
      </Box>
    );
  }

  // Connector list view (default)
  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">Connectors</Text>
        {filteredConnectors.length > 0 && (
          <Text dimColor>
            {' '}({safeConnectorIndex + 1}/{filteredConnectors.length}
            {searchQuery && ` matching "${searchQuery}"`}
            {connectors.length !== filteredConnectors.length && ` of ${connectors.length} total`})
          </Text>
        )}
      </Box>

      {/* Search input */}
      {isSearching && (
        <Box marginBottom={1}>
          <Text color="yellow">Search: </Text>
          <TextInput
            value={searchQuery}
            onChange={setSearchQuery}
            focus
            placeholder="Type to filter..."
          />
        </Box>
      )}

      {/* Search indicator when not in search mode but query exists */}
      {!isSearching && searchQuery && (
        <Box marginBottom={1}>
          <Text dimColor>Filter: </Text>
          <Text color="yellow">{searchQuery}</Text>
          <Text dimColor> (Esc to clear)</Text>
        </Box>
      )}

      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="#d4d4d8" borderLeft={false} borderRight={false}
        paddingX={1}
      >
        {filteredConnectors.length === 0 ? (
          <Box paddingY={1}>
            <Text dimColor>
              No connectors matching "{searchQuery}"
            </Text>
          </Box>
        ) : (
          <>
            {connectorRange.hasMore.above > 0 && (
              <Box paddingY={0}>
                <Text dimColor>  ↑ {connectorRange.hasMore.above} more above</Text>
              </Box>
            )}

            {visibleConnectors.map((connector, visibleIdx) => {
              const actualIdx = connectorRange.start + visibleIdx;
              const isSelected = actualIdx === safeConnectorIndex;
              const status = getStatusIcon(authStatuses.get(connector.name));
              const cmdCount = connector.commands?.length || 0;
              const prefix = isSelected ? '> ' : '  ';
              const nameDisplay = connector.name.padEnd(16);

              return (
                <Box key={connector.name} paddingY={0}>
                  <Text
                    inverse={isSelected}
                    dimColor={!isSelected}
                  >
                    {prefix}
                  </Text>
                  <Text color={status.color} inverse={isSelected}>
                    {status.icon}
                  </Text>
                  <Text
                    inverse={isSelected}
                    dimColor={!isSelected}
                  >
                    {' '}{nameDisplay} {cmdCount.toString().padStart(2)} cmd{cmdCount !== 1 ? 's' : ' '}
                  </Text>
                  <Text
                    inverse={isSelected}
                    dimColor
                  >
                    {' '}{connector.description?.slice(0, 30) || ''}
                  </Text>
                </Box>
              );
            })}

            {connectorRange.hasMore.below > 0 && (
              <Box paddingY={0}>
                <Text dimColor>  ↓ {connectorRange.hasMore.below} more below</Text>
              </Box>
            )}
          </>
        )}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Legend: </Text>
        <Text color="green">✓</Text>
        <Text dimColor> authenticated | </Text>
        <Text color="yellow">○</Text>
        <Text dimColor> not authenticated | </Text>
        <Text color="gray">?</Text>
        <Text dimColor> unknown</Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          ↑↓ navigate | Enter view | / search | q quit
        </Text>
      </Box>
    </Box>
  );
}
