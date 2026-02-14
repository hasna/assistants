import { useState, useCallback } from 'react';

interface UseListNavigationOptions {
  /** Total number of items in the list */
  itemCount: number;
  /** Whether to wrap around when reaching start/end (default: false) */
  wrapAround?: boolean;
  /** Initial selected index (default: 0) */
  initialIndex?: number;
}

interface UseListNavigationResult {
  /** Currently selected index */
  selectedIndex: number;
  /** Set the selected index directly */
  setSelectedIndex: (index: number | ((prev: number) => number)) => void;
  /** Move selection up */
  moveUp: () => void;
  /** Move selection down */
  moveDown: () => void;
  /** Reset to initial index */
  reset: () => void;
  /** Handle up/down arrow keys - returns true if handled */
  handleArrowKey: (direction: 'up' | 'down') => boolean;
}

/**
 * Shared hook for standardized list navigation across panels.
 * Supports optional wraparound and consistent bounds checking.
 */
export function useListNavigation(options: UseListNavigationOptions): UseListNavigationResult {
  const { itemCount, wrapAround = false, initialIndex = 0 } = options;
  const [selectedIndex, setSelectedIndex] = useState(initialIndex);

  const moveUp = useCallback(() => {
    setSelectedIndex((prev) => {
      if (prev <= 0) {
        return wrapAround ? Math.max(0, itemCount - 1) : 0;
      }
      return prev - 1;
    });
  }, [itemCount, wrapAround]);

  const moveDown = useCallback(() => {
    setSelectedIndex((prev) => {
      if (prev >= itemCount - 1) {
        return wrapAround ? 0 : Math.max(0, itemCount - 1);
      }
      return prev + 1;
    });
  }, [itemCount, wrapAround]);

  const reset = useCallback(() => {
    setSelectedIndex(initialIndex);
  }, [initialIndex]);

  const handleArrowKey = useCallback((direction: 'up' | 'down'): boolean => {
    if (itemCount === 0) return false;
    if (direction === 'up') { moveUp(); return true; }
    if (direction === 'down') { moveDown(); return true; }
    return false;
  }, [itemCount, moveUp, moveDown]);

  return {
    selectedIndex: Math.min(selectedIndex, Math.max(0, itemCount - 1)),
    setSelectedIndex,
    moveUp,
    moveDown,
    reset,
    handleArrowKey,
  };
}
