import { spawn } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { unlink, writeFileSync, appendFileSync } from 'fs';
import { findExecutable } from './utils';

export interface PlayOptions {
  format?: 'mp3' | 'wav' | 'aiff';
}

export class AudioPlayer {
  private currentProcess: ReturnType<typeof spawn> | null = null;
  private playing = false;

  async play(audio: ArrayBuffer, options: PlayOptions = {}): Promise<void> {
    const format = options.format ?? 'mp3';
    const tempFile = join(tmpdir(), `assistants-audio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${format}`);
    writeFileSync(tempFile, Buffer.from(audio));

    const player = this.resolvePlayer(format);
    if (!player) {
      throw new Error('No supported audio player found. Install afplay, ffplay, mpg123, or aplay.');
    }

    await new Promise<void>((resolve, reject) => {
      this.playing = true;
      this.currentProcess = spawn(player.command, [...player.args, tempFile], { stdio: 'ignore' });

      this.currentProcess.on('close', () => {
        this.playing = false;
        this.currentProcess = null;
        unlink(tempFile, () => {});
        resolve();
      });

      this.currentProcess.on('error', (error) => {
        this.playing = false;
        if (this.currentProcess) {
          this.currentProcess.kill();
          this.currentProcess = null;
        }
        unlink(tempFile, () => {});
        reject(error);
      });
    });
  }

  async playStream(chunks: AsyncGenerator<ArrayBuffer>, options: PlayOptions = {}): Promise<void> {
    const format = options.format ?? 'mp3';
    const tempFile = join(tmpdir(), `assistants-stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${format}`);
    // Write chunks to disk incrementally instead of buffering all in RAM
    writeFileSync(tempFile, Buffer.alloc(0));
    for await (const chunk of chunks) {
      appendFileSync(tempFile, Buffer.from(chunk));
    }
    // Play the completed temp file
    const player = this.resolvePlayer(format);
    if (!player) {
      unlink(tempFile, () => {});
      throw new Error('No supported audio player found.');
    }
    return new Promise<void>((resolve, reject) => {
      this.playing = true;
      this.currentProcess = spawn(player.command, [...player.args, tempFile]);
      this.currentProcess.on('close', () => {
        this.playing = false;
        this.currentProcess = null;
        unlink(tempFile, () => {});
        resolve();
      });
      this.currentProcess.on('error', (error) => {
        this.playing = false;
        if (this.currentProcess) {
          this.currentProcess.kill();
          this.currentProcess = null;
        }
        unlink(tempFile, () => {});
        reject(error);
      });
    });
  }

  stop(): void {
    if (this.currentProcess) {
      this.currentProcess.kill();
      this.currentProcess = null;
      this.playing = false;
    }
  }

  isPlaying(): boolean {
    return this.playing;
  }

  private resolvePlayer(format: string): { command: string; args: string[] } | null {
    if (process.platform === 'darwin') {
      const afplay = findExecutable('afplay');
      if (afplay) {
        return { command: afplay, args: [] };
      }
    }

    const ffplay = findExecutable('ffplay');
    if (ffplay) {
      return { command: ffplay, args: ['-nodisp', '-autoexit', '-loglevel', 'quiet'] };
    }

    const mpg123 = findExecutable('mpg123');
    if (mpg123 && format === 'mp3') {
      return { command: mpg123, args: ['-q'] };
    }

    const aplay = findExecutable('aplay');
    if (aplay && (format === 'wav' || format === 'aiff')) {
      return { command: aplay, args: [] };
    }

    return null;
  }
}
