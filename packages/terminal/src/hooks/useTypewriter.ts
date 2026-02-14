import { useState, useEffect, useRef } from 'react';

interface UseTypewriterResult {
  displayed: string;
  done: boolean;
}

/**
 * Typewriter animation hook - reveals text character by character.
 * @param text - Full text to reveal
 * @param speed - Milliseconds per character (default: 30)
 * @param active - Whether the animation should run (default: true)
 */
export function useTypewriter(text: string, speed = 30, active = true): UseTypewriterResult {
  const [charIndex, setCharIndex] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!active) return;
    setCharIndex(0);
  }, [text, active]);

  useEffect(() => {
    if (!active || charIndex >= text.length) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    intervalRef.current = setInterval(() => {
      setCharIndex((prev) => {
        if (prev >= text.length) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          return prev;
        }
        return prev + 1;
      });
    }, speed);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [text, speed, active, charIndex]);

  return {
    displayed: text.slice(0, charIndex),
    done: charIndex >= text.length,
  };
}
