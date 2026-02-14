import { spawn } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { readFileSync, existsSync, unlink } from 'fs';
import { findExecutable } from './utils';

export interface RecordOptions {
  durationSeconds?: number;
  sampleRate?: number;
  channels?: number;
}

interface RecorderCommand {
  command: string;
  args: string[];
}

export class AudioRecorder {
  private currentProcess: ReturnType<typeof spawn> | null = null;
  private stoppedIntentionally = false;
  private currentOutputPath: string | null = null;

  async record(options: RecordOptions = {}): Promise<ArrayBuffer> {
    if (this.currentProcess) {
      throw new Error('Audio recorder is already running.');
    }

    const duration = options.durationSeconds ?? 5;
    const sampleRate = options.sampleRate ?? 16000;
    const channels = options.channels ?? 1;
    const output = join(tmpdir(), `assistants-record-${Date.now()}.wav`);
    this.currentOutputPath = output;
    this.stoppedIntentionally = false;

    const recorder = this.resolveRecorder(sampleRate, channels, duration, output);
    if (!recorder) {
      throw new Error('No supported audio recorder found. Install sox or ffmpeg.');
    }

    await new Promise<void>((resolve, reject) => {
      this.currentProcess = spawn(recorder.command, recorder.args, { stdio: 'ignore' });
      this.currentProcess.on('close', (code) => {
        this.currentProcess = null;
        // Accept both normal completion (code 0) and intentional stop
        // When we send SIGINT, sox/ffmpeg may exit with non-zero but still write valid data
        if (code === 0 || this.stoppedIntentionally) {
          resolve();
        } else {
          reject(new Error('Audio recording failed.'));
        }
      });
      this.currentProcess.on('error', (error) => {
        this.currentProcess = null;
        reject(error);
      });
    });

    // If stopped intentionally and the file doesn't exist or is empty, return empty buffer
    if (!existsSync(output)) {
      this.currentOutputPath = null;
      return new ArrayBuffer(0);
    }
    const data = readFileSync(output);
    unlink(output, () => {});
    this.currentOutputPath = null;
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  }

  /**
   * Record until silence is detected (VAD-based).
   * Uses sox silence detection: stop after 2s of silence below 1% threshold.
   * Falls back to fixed duration recording if sox is not available.
   */
  async recordUntilSilence(options: RecordOptions = {}): Promise<ArrayBuffer> {
    if (this.currentProcess) {
      throw new Error('Audio recorder is already running.');
    }

    const sampleRate = options.sampleRate ?? 16000;
    const channels = options.channels ?? 1;
    const maxDuration = options.durationSeconds ?? 30;
    const output = join(tmpdir(), `assistants-record-${Date.now()}.wav`);
    this.currentOutputPath = output;
    this.stoppedIntentionally = false;

    const recorder = this.resolveVadRecorder(sampleRate, channels, maxDuration, output);
    if (!recorder) {
      // Fall back to standard fixed-duration recording
      return this.record({ ...options, durationSeconds: options.durationSeconds ?? 5 });
    }

    await new Promise<void>((resolve, reject) => {
      this.currentProcess = spawn(recorder.command, recorder.args, { stdio: 'ignore' });
      this.currentProcess.on('close', (code) => {
        this.currentProcess = null;
        if (code === 0 || this.stoppedIntentionally) {
          resolve();
        } else {
          reject(new Error('Audio recording failed.'));
        }
      });
      this.currentProcess.on('error', (error) => {
        this.currentProcess = null;
        reject(error);
      });
    });

    // If stopped intentionally and the file doesn't exist, return empty buffer
    if (!existsSync(output)) {
      this.currentOutputPath = null;
      return new ArrayBuffer(0);
    }
    const data = readFileSync(output);
    unlink(output, () => {});
    this.currentOutputPath = null;
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  }

  stop(): void {
    if (this.currentProcess) {
      this.stoppedIntentionally = true;
      // Use SIGINT for graceful shutdown - allows recording tools to flush buffers
      // This is more reliable than SIGTERM for audio tools like sox and ffmpeg
      this.currentProcess.kill('SIGINT');
    }
  }

  private resolveRecorder(
    sampleRate: number,
    channels: number,
    duration: number,
    output: string
  ): RecorderCommand | null {
    const sox = findExecutable('sox');
    if (sox) {
      return {
        command: sox,
        args: [
          '-d',
          '-c',
          String(channels),
          '-r',
          String(sampleRate),
          '-b',
          '16',
          output,
          'trim',
          '0',
          String(duration),
        ],
      };
    }

    const ffmpeg = findExecutable('ffmpeg');
    if (ffmpeg) {
      const baseArgs = ['-y', '-t', String(duration), '-ac', String(channels), '-ar', String(sampleRate)];
      if (process.platform === 'darwin') {
        return { command: ffmpeg, args: ['-f', 'avfoundation', '-i', ':0', ...baseArgs, output] };
      }
      if (process.platform === 'linux') {
        return { command: ffmpeg, args: ['-f', 'alsa', '-i', 'default', ...baseArgs, output] };
      }
    }

    const arecord = findExecutable('arecord');
    if (arecord) {
      return {
        command: arecord,
        args: [
          '-d',
          String(duration),
          '-f',
          'S16_LE',
          '-r',
          String(sampleRate),
          '-c',
          String(channels),
          output,
        ],
      };
    }

    return null;
  }

  /**
   * Resolve a recorder command with VAD (Voice Activity Detection).
   * Sox: start recording when sound > 1% for 0.1s, stop after 2s of silence.
   * Falls back to null if sox is not available.
   */
  private resolveVadRecorder(
    sampleRate: number,
    channels: number,
    maxDuration: number,
    output: string
  ): RecorderCommand | null {
    const sox = findExecutable('sox');
    if (sox) {
      return {
        command: sox,
        args: [
          '-d',
          '-c', String(channels),
          '-r', String(sampleRate),
          '-b', '16',
          output,
          'trim', '0', String(maxDuration),
          // silence filter: start on sound, stop after 2s silence
          'silence', '1', '0.1', '1%', '1', '2.0', '1%',
        ],
      };
    }

    return null;
  }
}
