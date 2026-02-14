import React, { useEffect, useState, useMemo } from 'react';
import { basename } from 'path';
import { Box, Text } from 'ink';
import type { EnergyState, VoiceState, ActiveIdentityInfo, HeartbeatState } from '@hasna/assistants-shared';

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  maxContextTokens: number;
}

/**
 * Recent tool call info for status display
 */
export interface RecentToolInfo {
  name: string;
  status: 'running' | 'succeeded' | 'failed';
  durationMs: number;
}

interface StatusProps {
  isProcessing: boolean;
  cwd: string;
  queueLength?: number;
  tokenUsage?: TokenUsage;
  energyState?: EnergyState;
  voiceState?: VoiceState;
  heartbeatState?: HeartbeatState;
  identityInfo?: ActiveIdentityInfo;
  sessionIndex?: number;
  sessionCount?: number;
  backgroundProcessingCount?: number;
  processingStartTime?: number;
  verboseTools?: boolean;
  recentTools?: RecentToolInfo[];
  gitBranch?: string;
}

export function Status({
  isProcessing,
  cwd,
  queueLength = 0,
  tokenUsage,
  energyState,
  voiceState,
  heartbeatState,
  identityInfo,
  sessionIndex,
  sessionCount,
  backgroundProcessingCount = 0,
  processingStartTime,
  verboseTools = false,
  recentTools = [],
  gitBranch,
}: StatusProps) {
  const [elapsed, setElapsed] = useState(0);
  const [heartbeatCountdown, setHeartbeatCountdown] = useState('');

  const formatDuration = (seconds: number): string => {
    if (!Number.isFinite(seconds) || seconds < 0) return '…';
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  useEffect(() => {
    if (!isProcessing || !processingStartTime) {
      setElapsed(0);
      return;
    }

    const update = () => {
      setElapsed(Math.max(0, Math.floor((Date.now() - processingStartTime) / 1000)));
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [isProcessing, processingStartTime]);

  useEffect(() => {
    if (!heartbeatState?.enabled) {
      setHeartbeatCountdown('');
      return;
    }

    const resolveNextHeartbeat = (): number => {
      if (heartbeatState.nextHeartbeatAt) {
        const nextAt = new Date(heartbeatState.nextHeartbeatAt).getTime();
        if (!Number.isNaN(nextAt)) {
          return nextAt;
        }
      }

      const intervalMs = heartbeatState.intervalMs ?? 15000;
      const lastActivityMs = new Date(heartbeatState.lastActivity).getTime();
      if (!Number.isNaN(lastActivityMs)) {
        return lastActivityMs + intervalMs;
      }

      return Date.now() + intervalMs;
    };

    const update = () => {
      const nextAt = resolveNextHeartbeat();
      const remainingSeconds = Math.max(0, Math.ceil((nextAt - Date.now()) / 1000));
      setHeartbeatCountdown(formatDuration(remainingSeconds));
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [heartbeatState?.enabled, heartbeatState?.nextHeartbeatAt, heartbeatState?.lastActivity, heartbeatState?.intervalMs]);

  // Folder name from cwd
  const folderName = basename(cwd);

  // Format context usage
  let contextInfo = '';
  if (tokenUsage && tokenUsage.maxContextTokens > 0) {
    const rawPercent = Math.round((tokenUsage.totalTokens / tokenUsage.maxContextTokens) * 100);
    const percent = Math.max(0, Math.min(100, rawPercent));
    contextInfo = `${percent}%`;
  }

  // Session indicator (only show if multiple sessions)
  const sessionInfo = sessionCount && sessionCount > 1 && sessionIndex !== undefined
    ? `${sessionIndex + 1}/${sessionCount}`
    : '';

  // Background processing indicator
  const bgIndicator = backgroundProcessingCount > 0
    ? ` +${backgroundProcessingCount}`
    : '';

  // Energy indicator (compact, flat)
  const energyInfo = energyState
    ? `${Math.round((energyState.current / energyState.max) * 100)}%`
    : '';

  // Voice indicator (flat text)
  const voiceLabel = voiceState?.enabled
    ? voiceState.isTalking ? 'talk' : voiceState.isListening ? 'mic' : voiceState.isSpeaking ? 'spk' : 'voice'
    : '';

  // Heartbeat indicator (flat text)
  const heartbeatLabel = heartbeatState?.enabled
    ? heartbeatState.isStale ? 'hb!' : 'hb'
    : '';
  const heartbeatDisplay = heartbeatLabel
    ? `${heartbeatLabel}${heartbeatCountdown ? ` ${heartbeatCountdown}` : ''}`
    : '';

  const queueInfo = queueLength > 0 ? `${queueLength}q` : '';
  const verboseLabel = verboseTools ? 'verbose' : '';

  // Build recent tools summary (group by tool name with counts)
  const recentToolsSummary = useMemo(() => {
    if (recentTools.length === 0) return '';

    const counts = new Map<string, { count: number; failed: number; running: number }>();
    for (const tool of recentTools) {
      const existing = counts.get(tool.name) || { count: 0, failed: 0, running: 0 };
      existing.count++;
      if (tool.status === 'failed') existing.failed++;
      if (tool.status === 'running') existing.running++;
      counts.set(tool.name, existing);
    }

    const parts: string[] = [];
    for (const [name, { count, failed, running }] of counts) {
      let part = name;
      if (count > 1) part += `x${count}`;
      if (failed > 0) part += '!';
      if (running > 0) part += '..';
      parts.push(part);
    }

    return parts.slice(0, 4).join(' ');
  }, [recentTools]);

  // Build right-side segments
  const rightParts: string[] = [];
  if (heartbeatDisplay) rightParts.push(heartbeatDisplay);
  if (voiceLabel) rightParts.push(voiceLabel);
  if (isProcessing) rightParts.push('esc');
  if (isProcessing && processingStartTime) rightParts.push(formatDuration(elapsed));
  if (sessionInfo) rightParts.push(`${sessionInfo}${bgIndicator}`);
  if (energyInfo) rightParts.push(energyInfo);
  if (contextInfo) rightParts.push(contextInfo);
  if (verboseLabel) rightParts.push(verboseLabel);
  if (queueInfo) rightParts.push(queueInfo);
  if (recentToolsSummary) rightParts.push(recentToolsSummary);

  // Build left-side segments
  const leftParts: string[] = [];
  leftParts.push(folderName);
  if (gitBranch) leftParts.push(gitBranch);

  return (
    <Box justifyContent="space-between">
      <Text dimColor>{leftParts.join(' · ')}</Text>
      <Text dimColor>{rightParts.join(' · ')}</Text>
    </Box>
  );
}
