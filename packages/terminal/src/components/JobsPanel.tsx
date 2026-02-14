import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Text } from 'ink';
import type { Job, JobManager, JobStatus } from '@hasna/assistants-core';
import { useSafeInput as useInput } from '../hooks/useSafeInput';

interface JobsPanelProps {
  manager: JobManager;
  onClose: () => void;
}

type ViewMode = 'list' | 'detail';
type FilterTab = 'all' | 'active' | 'done';

const FILTER_TABS: FilterTab[] = ['all', 'active', 'done'];
const MAX_VISIBLE_ROWS = 12;

function isActiveStatus(status: JobStatus): boolean {
  return status === 'pending' || status === 'running';
}

function isDoneStatus(status: JobStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'timeout' || status === 'cancelled';
}

function statusColor(status: JobStatus): string {
  switch (status) {
    case 'pending':
      return 'yellow';
    case 'running':
      return 'cyan';
    case 'completed':
      return 'green';
    case 'failed':
      return 'red';
    case 'timeout':
      return 'magenta';
    case 'cancelled':
      return 'gray';
    default:
      return 'white';
  }
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.max(0, Math.floor(diff / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function formatDuration(job: Job): string {
  const start = job.startedAt || job.createdAt;
  const end = job.completedAt || Date.now();
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
}

function fit(value: string, width: number, align: 'left' | 'right' = 'left'): string {
  const text = value || '';
  if (text.length > width) {
    return width > 3 ? `${text.slice(0, width - 3)}...` : text.slice(0, width);
  }
  return align === 'right' ? text.padStart(width, ' ') : text.padEnd(width, ' ');
}

function truncateText(value: string, maxLength: number): string {
  if (!value) return '';
  return value.length > maxLength ? `${value.slice(0, Math.max(0, maxLength - 3))}...` : value;
}

function visibleWindow(selectedIndex: number, total: number): { start: number; end: number; above: number; below: number } {
  if (total <= MAX_VISIBLE_ROWS) {
    return { start: 0, end: total, above: 0, below: 0 };
  }

  const half = Math.floor(MAX_VISIBLE_ROWS / 2);
  let start = selectedIndex - half;
  let end = start + MAX_VISIBLE_ROWS;

  if (start < 0) {
    start = 0;
    end = MAX_VISIBLE_ROWS;
  }

  if (end > total) {
    end = total;
    start = Math.max(0, end - MAX_VISIBLE_ROWS);
  }

  return {
    start,
    end,
    above: start,
    below: total - end,
  };
}

function statusBadge(status: JobStatus): string {
  switch (status) {
    case 'pending':
      return 'PENDING';
    case 'running':
      return 'RUNNING';
    case 'completed':
      return 'DONE';
    case 'failed':
      return 'FAILED';
    case 'timeout':
      return 'TIMEOUT';
    case 'cancelled':
      return 'CANCELLED';
  }
  return 'UNKNOWN';
}

export function JobsPanel({ manager, onClose }: JobsPanelProps) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mode, setMode] = useState<ViewMode>('list');
  const [detailJobId, setDetailJobId] = useState<string | null>(null);
  const [filterIndex, setFilterIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const refreshJobs = useCallback(async (notify = false) => {
    try {
      const data = await manager.listSessionJobs();
      const sorted = [...data].sort((a, b) => {
        const aActive = isActiveStatus(a.status) ? 0 : 1;
        const bActive = isActiveStatus(b.status) ? 0 : 1;
        if (aActive !== bActive) return aActive - bActive;
        return b.createdAt - a.createdAt;
      });
      setJobs(sorted);
      setError(null);
      if (notify) setStatusMessage('Refreshed jobs.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [manager]);

  useEffect(() => {
    void refreshJobs(false);
  }, [refreshJobs]);

  useEffect(() => {
    if (!statusMessage) return;
    const timer = setTimeout(() => setStatusMessage(null), 2200);
    return () => clearTimeout(timer);
  }, [statusMessage]);

  const activeFilter = FILTER_TABS[filterIndex] || 'all';

  const filteredJobs = useMemo(() => {
    if (activeFilter === 'all') return jobs;
    if (activeFilter === 'active') return jobs.filter((job) => isActiveStatus(job.status));
    return jobs.filter((job) => isDoneStatus(job.status));
  }, [activeFilter, jobs]);

  useEffect(() => {
    setSelectedIndex((prev) => Math.min(prev, Math.max(0, filteredJobs.length - 1)));
  }, [filteredJobs.length]);

  const detailJob = useMemo(() => {
    if (!detailJobId) return null;
    return jobs.find((job) => job.id === detailJobId) ?? null;
  }, [jobs, detailJobId]);

  useEffect(() => {
    if (mode === 'detail' && !detailJob) {
      setMode('list');
      setDetailJobId(null);
    }
  }, [mode, detailJob]);

  const cancelJob = useCallback(async (job: Job | null) => {
    if (!job || isWorking) return;
    if (!isActiveStatus(job.status)) {
      setStatusMessage(`Job ${job.id} is ${job.status}. Only pending/running jobs can be killed.`);
      return;
    }
    setIsWorking(true);
    try {
      const cancelled = await manager.cancelJob(job.id);
      if (cancelled) {
        setStatusMessage(`Killed ${job.id}.`);
      } else {
        setStatusMessage(`Could not kill ${job.id}.`);
      }
      await refreshJobs(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsWorking(false);
    }
  }, [isWorking, manager, refreshJobs]);

  const killAllActiveJobs = useCallback(async () => {
    if (isWorking) return;
    const activeJobs = jobs.filter((job) => isActiveStatus(job.status));
    if (activeJobs.length === 0) {
      setStatusMessage('No active jobs to kill.');
      return;
    }

    setIsWorking(true);
    try {
      let killed = 0;
      for (const job of activeJobs) {
        try {
          const cancelled = await manager.cancelJob(job.id);
          if (cancelled) killed += 1;
        } catch {
          // Continue cancelling the rest even if one cancellation fails.
        }
      }

      if (killed === 0) {
        setStatusMessage('Could not kill any active jobs.');
      } else if (killed === activeJobs.length) {
        setStatusMessage(`Killed ${killed} active job${killed === 1 ? '' : 's'}.`);
      } else {
        setStatusMessage(`Killed ${killed}/${activeJobs.length} active jobs.`);
      }
      await refreshJobs(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsWorking(false);
    }
  }, [isWorking, jobs, manager, refreshJobs]);

  const openDetail = useCallback(() => {
    const selected = filteredJobs[selectedIndex];
    if (!selected) return;
    setDetailJobId(selected.id);
    setMode('detail');
  }, [filteredJobs, selectedIndex]);

  useInput((input, key) => {
    if (mode === 'detail') {
      if (input === 'q') {
        onClose();
        return;
      }
      if (key.escape || key.backspace) {
        setMode('list');
        setDetailJobId(null);
        return;
      }
      if (input === 'r') {
        void refreshJobs(true);
        return;
      }
      if (input === 'K') {
        void killAllActiveJobs();
        return;
      }
      if (input === 'x' || input === 'c' || input === 'd') {
        void cancelJob(detailJob);
      }
      return;
    }

    if (input === 'q' || key.escape) {
      onClose();
      return;
    }

    if (input === '1') {
      setFilterIndex(0);
      setSelectedIndex(0);
      return;
    }
    if (input === '2') {
      setFilterIndex(1);
      setSelectedIndex(0);
      return;
    }
    if (input === '3') {
      setFilterIndex(2);
      setSelectedIndex(0);
      return;
    }

    if (key.leftArrow) {
      setFilterIndex((prev) => (prev === 0 ? FILTER_TABS.length - 1 : prev - 1));
      setSelectedIndex(0);
      return;
    }
    if (key.rightArrow) {
      setFilterIndex((prev) => (prev === FILTER_TABS.length - 1 ? 0 : prev + 1));
      setSelectedIndex(0);
      return;
    }

    if (key.upArrow || input === 'k') {
      if (filteredJobs.length === 0) return;
      setSelectedIndex((prev) => (prev === 0 ? filteredJobs.length - 1 : prev - 1));
      return;
    }

    if (key.downArrow || input === 'j') {
      if (filteredJobs.length === 0) return;
      setSelectedIndex((prev) => (prev >= filteredJobs.length - 1 ? 0 : prev + 1));
      return;
    }

    if (key.return) {
      openDetail();
      return;
    }

    if (input === 'r') {
      void refreshJobs(true);
      return;
    }

    if (input === 'K') {
      void killAllActiveJobs();
      return;
    }

    if (input === 'x' || input === 'c' || input === 'd') {
      void cancelJob(filteredJobs[selectedIndex] || null);
    }
  });

  if (isLoading) {
    return (
      <Box flexDirection="column">
        <Text bold>Jobs</Text>
        <Text color="gray">Loading jobs...</Text>
      </Box>
    );
  }

  const tabLabel = (
    <Box marginBottom={1}>
      {FILTER_TABS.map((tab, index) => (
        <Box key={tab} marginRight={1}>
          <Text color={index === filterIndex ? 'cyan' : 'gray'}>
            {index + 1}:{tab}
          </Text>
        </Box>
      ))}
      <Text color="gray">
        ({jobs.length} total, {jobs.filter((job) => isActiveStatus(job.status)).length} active)
      </Text>
    </Box>
  );

  if (mode === 'detail' && detailJob) {
    const resultPreview = detailJob.result?.content ? truncateText(detailJob.result.content, 900) : null;
    const errorPreview = detailJob.error?.message ? truncateText(detailJob.error.message, 300) : null;
    return (
      <Box flexDirection="column">
        <Text bold>Job Detail</Text>
        <Box marginTop={1}>
          <Text>ID: {detailJob.id}</Text>
        </Box>
        <Text>
          Status:{' '}
          <Text color={statusColor(detailJob.status)}>{statusBadge(detailJob.status)}</Text>
        </Text>
        <Text>Connector: {detailJob.connectorName}</Text>
        <Text>Command: {detailJob.command}</Text>
        <Text>Session: {detailJob.sessionId}</Text>
        <Text>Created: {new Date(detailJob.createdAt).toLocaleString()}</Text>
        <Text>Started: {detailJob.startedAt ? new Date(detailJob.startedAt).toLocaleString() : '-'}</Text>
        <Text>Completed: {detailJob.completedAt ? new Date(detailJob.completedAt).toLocaleString() : '-'}</Text>
        <Text>Timeout: {Math.round(detailJob.timeoutMs / 1000)}s</Text>
        <Text>Duration: {formatDuration(detailJob)}</Text>
        {resultPreview && (
          <Box marginTop={1} flexDirection="column">
            <Text color="green">Result:</Text>
            <Text>{resultPreview}</Text>
          </Box>
        )}
        {errorPreview && (
          <Box marginTop={1} flexDirection="column">
            <Text color="red">Error:</Text>
            <Text>{errorPreview}</Text>
          </Box>
        )}
        {error && (
          <Text color="red">{error}</Text>
        )}
        {statusMessage && (
          <Text color="cyan">{statusMessage}</Text>
        )}
        <Box marginTop={1}>
          <Text color="gray">d/x/c kill selected  K kill all active  r refresh  esc back  q close</Text>
        </Box>
      </Box>
    );
  }

  const windowed = visibleWindow(selectedIndex, filteredJobs.length);
  const visibleRows = filteredJobs.slice(windowed.start, windowed.end);

  return (
    <Box flexDirection="column">
      <Text bold>Jobs</Text>
      {tabLabel}

      <Text color="gray">{fit('Status', 10)} {fit('ID', 16)} {fit('Connector', 14)} {fit('Age', 6, 'right')} {fit('Run', 6, 'right')} Command</Text>
      <Text color="gray">{'-'.repeat(86)}</Text>

      {filteredJobs.length === 0 && (
        <Text color="gray">
          {activeFilter === 'all' ? 'No jobs in this session.' : activeFilter === 'active' ? 'No active jobs.' : 'No completed/failed jobs.'}
        </Text>
      )}

      {windowed.above > 0 && (
        <Text color="gray">... {windowed.above} above ...</Text>
      )}
      {visibleRows.map((job, idx) => {
        const absolute = windowed.start + idx;
        const selected = absolute === selectedIndex;
        return (
          <Box key={job.id}>
            <Text color={selected ? 'cyan' : 'gray'}>{selected ? '>' : ' '}</Text>
            <Text> </Text>
            <Text color={statusColor(job.status)}>{fit(statusBadge(job.status), 10)}</Text>
            <Text> </Text>
            <Text>{fit(job.id, 16)}</Text>
            <Text> </Text>
            <Text>{fit(job.connectorName, 14)}</Text>
            <Text> </Text>
            <Text>{fit(formatRelativeTime(job.createdAt), 6, 'right')}</Text>
            <Text> </Text>
            <Text>{fit(formatDuration(job), 6, 'right')}</Text>
            <Text> </Text>
            <Text>{truncateText(job.command, 28)}</Text>
          </Box>
        );
      })}
      {windowed.below > 0 && (
        <Text color="gray">... {windowed.below} below ...</Text>
      )}

      {error && (
        <Text color="red">{error}</Text>
      )}
      {statusMessage && (
        <Text color="cyan">{statusMessage}</Text>
      )}
      {isWorking && (
        <Text color="yellow">Applying action...</Text>
      )}

      <Box marginTop={1}>
        <Text color="gray">j/k or arrows move  enter view  d/x/c kill selected  K kill all active  r refresh  1/2/3 filter  q close</Text>
      </Box>
    </Box>
  );
}
