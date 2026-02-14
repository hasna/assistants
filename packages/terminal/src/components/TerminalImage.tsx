import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';

interface TerminalImageProps {
  src: string;
  width?: number;
  height?: number;
  alt?: string;
}

/**
 * Renders an image in the terminal using ink-picture.
 * ink-picture is loaded lazily to avoid crashing on startup —
 * its TerminalInfoProvider calls setRawMode via escape sequence queries
 * which can fail in non-TTY or certain terminal environments.
 */
export function TerminalImage({ src, width, height, alt }: TerminalImageProps) {
  const [ImageModule, setImageModule] = useState<{
    default: React.ComponentType<any>;
    TerminalInfoProvider: React.ComponentType<{ children: React.ReactNode }>;
  } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    import('ink-picture')
      .then((mod) => {
        if (!cancelled) setImageModule(mod as any);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => { cancelled = true; };
  }, []);

  if (failed) {
    return (
      <Box flexDirection="column" marginY={1}>
        <Text dimColor>[Image: {alt || src}]</Text>
      </Box>
    );
  }

  if (!ImageModule) {
    return (
      <Box flexDirection="column" marginY={1}>
        <Text dimColor>Loading image...</Text>
      </Box>
    );
  }

  const { default: Image, TerminalInfoProvider } = ImageModule;

  return (
    <TerminalInfoProvider>
      <Box flexDirection="column" marginY={1}>
        <Image
          src={src}
          width={width || 60}
          height={height || 20}
          alt={alt || src}
        />
        {alt && <Text dimColor>{alt}</Text>}
      </Box>
    </TerminalInfoProvider>
  );
}
