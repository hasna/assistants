import React, { useState, useMemo, useEffect } from 'react';
import { Box, Text } from 'ink';
import type { Email, EmailListItem } from '@hasna/assistants-shared';
import { useSafeInput as useInput } from '../hooks/useSafeInput';

// Maximum visible items in lists before pagination kicks in
const MAX_VISIBLE_ITEMS = 5;

type ViewMode = 'list' | 'detail' | 'delete-confirm';

interface InboxPanelProps {
  emails: EmailListItem[];
  onRead: (id: string) => Promise<Email>;
  onDelete: (id: string) => Promise<void>;
  onFetch: () => Promise<number>;
  onMarkRead: (id: string) => Promise<void>;
  onMarkUnread: (id: string) => Promise<void>;
  onReply: (id: string) => void;
  onClose: () => void;
  error?: string | null;
}

/**
 * Calculate the visible window range for paginated lists
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

  const halfWindow = Math.floor(maxVisible / 2);
  let start = selectedIndex - halfWindow;
  let end = selectedIndex + (maxVisible - halfWindow);

  if (start < 0) {
    start = 0;
    end = maxVisible;
  }

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

/**
 * Format relative time
 */
function formatRelativeTime(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMin < 1) return 'now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

/**
 * Get status icon
 */
function getStatusIcon(isRead: boolean): string {
  return isRead ? '📖' : '📬';
}

/**
 * Interactive panel for managing assistant inbox
 */
export function InboxPanel({
  emails,
  onRead,
  onDelete,
  onFetch,
  onMarkRead,
  onMarkUnread,
  onReply,
  onClose,
  error,
}: InboxPanelProps) {
  const [mode, setMode] = useState<ViewMode>('list');
  const [emailIndex, setEmailIndex] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<EmailListItem | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [detailEmail, setDetailEmail] = useState<Email | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    setEmailIndex((prev) => Math.min(prev, Math.max(0, emails.length - 1)));
  }, [emails.length]);

  useEffect(() => {
    if (mode === 'detail' && !detailEmail) {
      setMode('list');
    }
    if (mode === 'delete-confirm' && !deleteTarget) {
      setMode('list');
    }
  }, [mode, detailEmail, deleteTarget]);

  // Calculate visible range for emails list
  const emailRange = useMemo(
    () => getVisibleRange(emailIndex, emails.length),
    [emailIndex, emails.length]
  );

  const currentEmail = emails[emailIndex];

  // Handle view details
  const handleViewDetails = async () => {
    if (!currentEmail) return;

    setIsProcessing(true);
    setStatusMessage('Loading...');
    try {
      const details = await onRead(currentEmail.id);
      setDetailEmail(details);
      setMode('detail');
      setStatusMessage(null);
    } catch (err) {
      setStatusMessage(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle delete
  const handleDelete = async () => {
    if (!deleteTarget) return;

    setIsProcessing(true);
    setStatusMessage('Deleting...');
    try {
      await onDelete(deleteTarget.id);
      setMode('list');
      setDeleteTarget(null);
      setDetailEmail(null);
      setStatusMessage('Email deleted.');
      // Adjust index if needed
      if (emailIndex >= emails.length - 1 && emailIndex > 0) {
        setEmailIndex(emailIndex - 1);
      }
      // Clear status after a moment
      setTimeout(() => setStatusMessage(null), 2000);
    } catch (err) {
      setStatusMessage(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle fetch new emails
  const handleFetch = async () => {
    setIsProcessing(true);
    setStatusMessage('Fetching new emails...');
    try {
      const count = await onFetch();
      if (count === 0) {
        setStatusMessage('No new emails.');
      } else {
        setStatusMessage(`Fetched ${count} new email(s).`);
      }
      // Clear status after a moment
      setTimeout(() => setStatusMessage(null), 3000);
    } catch (err) {
      setStatusMessage(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle toggle read/unread
  const handleToggleRead = async () => {
    if (!detailEmail) return;

    setIsProcessing(true);
    try {
      const emailItem = emails.find((e) => e.id === detailEmail.id);
      if (emailItem?.isRead) {
        await onMarkUnread(detailEmail.id);
        setStatusMessage('Marked as unread.');
      } else {
        await onMarkRead(detailEmail.id);
        setStatusMessage('Marked as read.');
      }
      setTimeout(() => setStatusMessage(null), 2000);
    } catch (err) {
      setStatusMessage(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Keyboard navigation
  useInput((input, key) => {
    if (isProcessing) return;

    // Exit with q or Escape at top level
    if (input === 'q' || (key.escape && mode === 'list')) {
      onClose();
      return;
    }

    // Escape to go back
    if (key.escape) {
      if (mode === 'detail') {
        setMode('list');
        setDetailEmail(null);
      } else if (mode === 'delete-confirm') {
        setMode('detail');
        setDeleteTarget(null);
      }
      return;
    }

    // List mode navigation
    if (mode === 'list') {
      if (emails.length === 0) {
        return;
      }
      if (key.upArrow) {
        setEmailIndex((prev) => (prev === 0 ? emails.length - 1 : prev - 1));
        return;
      }
      if (key.downArrow) {
        setEmailIndex((prev) => (prev === emails.length - 1 ? 0 : prev + 1));
        return;
      }
      if (key.return && currentEmail) {
        handleViewDetails();
        return;
      }
      // Fetch new emails
      if (input === 'f') {
        handleFetch();
        return;
      }
      // Number keys for quick selection
      const num = parseInt(input, 10);
      if (!isNaN(num) && num >= 1 && num <= emails.length) {
        setEmailIndex(num - 1);
      }
      return;
    }

    // Detail mode
    if (mode === 'detail') {
      if (input === 'r') {
        if (detailEmail) {
          onReply(detailEmail.id);
          onClose();
        }
        return;
      }
      if (input === 'u') {
        handleToggleRead();
        return;
      }
      if (input === 'd' || key.delete) {
        if (detailEmail) {
          const emailItem = emails.find((e) => e.id === detailEmail.id);
          if (emailItem) {
            setDeleteTarget(emailItem);
            setMode('delete-confirm');
          }
        }
        return;
      }
      return;
    }

    // Delete confirm mode
    if (mode === 'delete-confirm') {
      if (input === 'y') {
        handleDelete();
        return;
      }
      if (input === 'n') {
        setMode('detail');
        setDeleteTarget(null);
        return;
      }
    }
  });

  // Empty state
  if (emails.length === 0 && mode === 'list') {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">Inbox</Text>
        </Box>
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="#d4d4d8" borderLeft={false} borderRight={false}
          paddingX={1}
          paddingY={1}
        >
          <Text dimColor>No emails in inbox.</Text>
          <Text dimColor>Press f to fetch new emails from server.</Text>
        </Box>
        {statusMessage && (
          <Box marginTop={1}>
            <Text color={statusMessage.startsWith('Error') ? 'red' : 'green'}>{statusMessage}</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <Text dimColor>f fetch | q quit</Text>
        </Box>
      </Box>
    );
  }

  // Delete confirmation
  if (mode === 'delete-confirm' && deleteTarget) {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color="red">Delete Email</Text>
        </Box>
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="#d4d4d8" borderLeft={false} borderRight={false}
          paddingX={1}
          paddingY={1}
        >
          <Text>Are you sure you want to delete this email?</Text>
          <Text dimColor>From: {deleteTarget.from}</Text>
          <Text dimColor>Subject: {deleteTarget.subject}</Text>
          <Text dimColor>This action cannot be undone.</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>y confirm | n cancel</Text>
        </Box>
      </Box>
    );
  }

  // Detail view
  if (mode === 'detail' && detailEmail) {
    const emailItem = emails.find((e) => e.id === detailEmail.id);
    const statusIcon = getStatusIcon(emailItem?.isRead ?? true);

    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">{statusIcon} Email</Text>
          {emailItem?.hasAttachments && <Text> 📎</Text>}
        </Box>

        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="#d4d4d8" borderLeft={false} borderRight={false}
          paddingX={1}
          paddingY={1}
        >
          <Box>
            <Text dimColor>From: </Text>
            <Text>{detailEmail.from.name || detailEmail.from.address}</Text>
            {detailEmail.from.name && (
              <Text dimColor> &lt;{detailEmail.from.address}&gt;</Text>
            )}
          </Box>

          <Box>
            <Text dimColor>To: </Text>
            <Text>
              {detailEmail.to.map((t) => t.name || t.address).join(', ')}
            </Text>
          </Box>

          {detailEmail.cc && detailEmail.cc.length > 0 && (
            <Box>
              <Text dimColor>Cc: </Text>
              <Text>
                {detailEmail.cc.map((c) => c.name || c.address).join(', ')}
              </Text>
            </Box>
          )}

          <Box>
            <Text dimColor>Subject: </Text>
            <Text bold>{detailEmail.subject}</Text>
          </Box>

          <Box>
            <Text dimColor>Date: </Text>
            <Text>{formatRelativeTime(detailEmail.date)}</Text>
            <Text dimColor> ({new Date(detailEmail.date).toLocaleString()})</Text>
          </Box>

          {detailEmail.attachments && detailEmail.attachments.length > 0 && (
            <Box>
              <Text dimColor>Attachments: </Text>
              <Text>
                {detailEmail.attachments.map((a) => a.filename).join(', ')}
              </Text>
            </Box>
          )}

          <Box marginTop={1} flexDirection="column">
            <Text dimColor>Message:</Text>
            <Text wrap="wrap">
              {detailEmail.body.text || '(No text content)'}
            </Text>
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
            r reply | u toggle read | d delete | Esc back
          </Text>
        </Box>
      </Box>
    );
  }

  // List view (default)
  const visibleEmails = emails.slice(emailRange.start, emailRange.end);

  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">Inbox</Text>
        {emails.length > MAX_VISIBLE_ITEMS && (
          <Text dimColor> ({emailIndex + 1}/{emails.length})</Text>
        )}
      </Box>

      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="#d4d4d8" borderLeft={false} borderRight={false}
        paddingX={1}
      >
        {emailRange.hasMore.above > 0 && (
          <Box paddingY={0}>
            <Text dimColor>  ↑ {emailRange.hasMore.above} more above</Text>
          </Box>
        )}

        {visibleEmails.map((email, visibleIdx) => {
          const actualIdx = emailRange.start + visibleIdx;
          const isSelected = actualIdx === emailIndex;
          const prefix = isSelected ? '> ' : '  ';
          const statusIcon = getStatusIcon(email.isRead);
          const attachIcon = email.hasAttachments ? ' 📎' : '  ';
          const fromStr = email.from.slice(0, 16).padEnd(16);
          const subject = email.subject.slice(0, 25).padEnd(25);

          return (
            <Box key={email.id} paddingY={0}>
              <Text inverse={isSelected} dimColor={!isSelected}>
                {prefix}{statusIcon}{attachIcon}{' '}
              </Text>
              <Text inverse={isSelected} dimColor={email.isRead}>
                {fromStr}
              </Text>
              <Text inverse={isSelected} dimColor={email.isRead}>
                {' '}{subject}
              </Text>
              <Text inverse={isSelected} dimColor>
                {' '}{formatRelativeTime(email.date)}
              </Text>
            </Box>
          );
        })}

        {emailRange.hasMore.below > 0 && (
          <Box paddingY={0}>
            <Text dimColor>  ↓ {emailRange.hasMore.below} more below</Text>
          </Box>
        )}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Legend: </Text>
        <Text>📬</Text>
        <Text dimColor> unread | </Text>
        <Text>📖</Text>
        <Text dimColor> read | </Text>
        <Text>📎</Text>
        <Text dimColor> attachment</Text>
      </Box>

      {statusMessage && (
        <Box marginTop={1}>
          <Text color={statusMessage.startsWith('Error') ? 'red' : 'green'}>{statusMessage}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>
          ↑↓ select | Enter view | f fetch | q quit
        </Text>
      </Box>
    </Box>
  );
}
