import { useState, useEffect, useRef } from 'react';

const COLORS = ['cyan', 'blue', 'magenta', 'red', 'yellow', 'green'] as const;

/**
 * Color cycling hook for animated text.
 * @param intervalMs - Milliseconds between color changes (default: 800)
 * @returns Current color name from the cycle
 */
export function useGradientCycle(intervalMs = 800): string {
  const [index, setIndex] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setIndex((prev) => (prev + 1) % COLORS.length);
    }, intervalMs);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [intervalMs]);

  return COLORS[index];
}
