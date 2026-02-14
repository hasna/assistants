import React, { useState, useEffect, useMemo } from 'react';
import { Box, Text } from 'ink';
import { getSecurityLogger, SecurityLogger } from '@hasna/assistants-core';
import type { SecurityEvent, Severity } from '@hasna/assistants-core';
import { useSafeInput as useInput } from '../hooks/useSafeInput';

interface LogsPanelProps {
  onCancel: () => void;
}

type Mode = 'list' | 'detail';
type SeverityFilter = 'all' | Severity;
type EventTypeFilter = 'all' | SecurityEvent['eventType'];

const SEVERITY_ICONS: Record<Severity, string> = {
  critical: '!!',
  high: '!',
  medium: '~',
  low: '.',
};

const SEVERITY_COLORS: Record<Severity, string> = {
  critical: 'red',
  high: 'yellow',
  medium: 'cyan',
  low: 'gray',
};

const SEVERITY_CYCLE: SeverityFilter[] = ['all', 'critical', 'high', 'medium', 'low'];
const EVENT_TYPE_CYCLE: EventTypeFilter[] = ['all', 'blocked_command', 'path_violation', 'validation_failure'];

const EVENT_TYPE_LABELS: Record<SecurityEvent['eventType'], string> = {
  blocked_command: 'Blocked Command',
  path_violation: 'Path Violation',
  validation_failure: 'Validation Failure',
};

function formatRelativeTime(isoTimestamp: string): string {
  const now = Date.now();
  const ts = new Date(isoTimestamp).getTime();
  const diff = now - ts;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return `${seconds}s ago`;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}

function eventKey(event: SecurityEvent): string {
  return `${event.timestamp}|${event.eventType}|${event.severity}|${event.sessionId}|${JSON.stringify(event.details)}`;
}

function readAllEvents(): SecurityEvent[] {
  const logger = getSecurityLogger();
  const inMemory = logger.getEvents({});
  const persisted = SecurityLogger.readPersistedEvents({ logFile: logger.getLogFile() });
  const deduped = new Map<string, SecurityEvent>();
  for (const event of [...persisted, ...inMemory]) {
    deduped.set(eventKey(event), event);
  }
  const combined = Array.from(deduped.values());
  combined.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return combined;
}

export function LogsPanel({ onCancel }: LogsPanelProps) {
  const [mode, setMode] = useState<Mode>('list');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [eventTypeFilter, setEventTypeFilter] = useState<EventTypeFilter>('all');
  const [allEvents, setAllEvents] = useState<SecurityEvent[]>(() => readAllEvents());

  const loadEvents = () => {
    setAllEvents(readAllEvents());
  };

  useEffect(() => {
    loadEvents();
    const timer = setInterval(() => {
      loadEvents();
    }, 2000);
    return () => clearInterval(timer);
  }, []);

  const filteredEvents = useMemo(() => {
    return allEvents.filter((event) => {
      if (severityFilter !== 'all' && event.severity !== severityFilter) return false;
      if (eventTypeFilter !== 'all' && event.eventType !== eventTypeFilter) return false;
      return true;
    });
  }, [allEvents, severityFilter, eventTypeFilter]);

  useEffect(() => {
    setSelectedIndex((prev) => Math.min(prev, Math.max(0, filteredEvents.length - 1)));
  }, [filteredEvents.length]);

  const selectedEvent = filteredEvents[selectedIndex];

  useEffect(() => {
    if (mode === 'detail' && !selectedEvent) {
      setMode('list');
    }
  }, [mode, selectedEvent]);

  useInput((input, key) => {
    if (mode === 'detail') {
      if (key.escape || input === 'q' || input === 'Q') {
        setMode('list');
        return;
      }
      return;
    }

    // List mode
    if (key.escape || input === 'q' || input === 'Q') {
      onCancel();
      return;
    }

    if (key.return && filteredEvents.length > 0) {
      setMode('detail');
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((prev) => (prev === 0 ? Math.max(0, filteredEvents.length - 1) : prev - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((prev) => (prev >= filteredEvents.length - 1 ? 0 : prev + 1));
      return;
    }

    // Severity filter cycle
    if (input === 's' || input === 'S') {
      setSeverityFilter((prev) => {
        const idx = SEVERITY_CYCLE.indexOf(prev);
        return SEVERITY_CYCLE[(idx + 1) % SEVERITY_CYCLE.length];
      });
      setSelectedIndex(0);
      return;
    }

    // Event type filter cycle
    if (input === 't' || input === 'T') {
      setEventTypeFilter((prev) => {
        const idx = EVENT_TYPE_CYCLE.indexOf(prev);
        return EVENT_TYPE_CYCLE[(idx + 1) % EVENT_TYPE_CYCLE.length];
      });
      setSelectedIndex(0);
      return;
    }

    // Manual refresh
    if (input === 'r' || input === 'R') {
      loadEvents();
      return;
    }
  });

  // ── Detail View ───────────────────────────────────────────────────

  if (mode === 'detail' && selectedEvent) {
    const e = selectedEvent;
    const severityColor = SEVERITY_COLORS[e.severity];

    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">Log Entry Details</Text>
        </Box>

        <Box flexDirection="column" borderStyle="round" borderColor="#d4d4d8" borderLeft={false} borderRight={false} paddingX={1} paddingY={0}>
          <Box><Text bold>Timestamp: </Text><Text>{new Date(e.timestamp).toLocaleString()} ({formatRelativeTime(e.timestamp)})</Text></Box>
          <Box><Text bold>Severity: </Text><Text color={severityColor}>{SEVERITY_ICONS[e.severity]} {e.severity}</Text></Box>
          <Box><Text bold>Event Type: </Text><Text>{EVENT_TYPE_LABELS[e.eventType] || e.eventType}</Text></Box>
          <Box><Text bold>Session: </Text><Text dimColor>{e.sessionId}</Text></Box>

          <Box marginTop={1}><Text bold>Details:</Text></Box>
          {e.details.tool && (
            <Box marginLeft={2}><Text bold>Tool: </Text><Text>{e.details.tool}</Text></Box>
          )}
          {e.details.command && (
            <Box marginLeft={2}><Text bold>Command: </Text><Text color="cyan" wrap="wrap">{e.details.command}</Text></Box>
          )}
          {e.details.path && (
            <Box marginLeft={2}><Text bold>Path: </Text><Text wrap="wrap">{e.details.path}</Text></Box>
          )}
          <Box marginLeft={2}><Text bold>Reason: </Text><Text wrap="wrap">{e.details.reason}</Text></Box>
        </Box>

        <Box marginTop={1}>
          <Text dimColor>Esc/q back</Text>
        </Box>
      </Box>
    );
  }

  // ── List View ─────────────────────────────────────────────────────

  const hasFilters = severityFilter !== 'all' || eventTypeFilter !== 'all';

  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1} justifyContent="space-between">
        <Text bold>Security Logs</Text>
        <Text dimColor>{filteredEvents.length} event{filteredEvents.length !== 1 ? 's' : ''}</Text>
      </Box>

      {hasFilters && (
        <Box marginBottom={1}>
          <Text dimColor>Filters: </Text>
          {severityFilter !== 'all' && (
            <Text color={SEVERITY_COLORS[severityFilter]}>[severity: {severityFilter}] </Text>
          )}
          {eventTypeFilter !== 'all' && (
            <Text color="cyan">[type: {eventTypeFilter}] </Text>
          )}
        </Box>
      )}

      <Box flexDirection="column" borderStyle="round" borderColor="#d4d4d8" borderLeft={false} borderRight={false} paddingX={1}>
        {filteredEvents.length === 0 ? (
          <Box paddingY={1}>
            <Text dimColor>
              {allEvents.length === 0
                ? 'No security events recorded.'
                : 'No events match current filters.'}
            </Text>
          </Box>
        ) : (
          filteredEvents.map((event, index) => {
            const isSelected = index === selectedIndex;
            const severityColor = SEVERITY_COLORS[event.severity];
            const icon = SEVERITY_ICONS[event.severity];
            const time = formatRelativeTime(event.timestamp);
            const reason = event.details?.reason || event.details?.command || event.details?.path || 'n/a';

            return (
              <Box key={`${event.timestamp}-${index}`} paddingY={0}>
                <Text inverse={isSelected}>
                  <Text color={severityColor}>{icon.padEnd(2)}</Text>
                  {' '}
                  {time.padEnd(8)} {event.eventType.padEnd(20)} {truncate(reason, 40)}
                </Text>
              </Box>
            );
          })
        )}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          ↑↓ navigate | Enter details | [s]everity filter | [t]ype filter | [r]efresh | q quit
        </Text>
      </Box>
    </Box>
  );
}
