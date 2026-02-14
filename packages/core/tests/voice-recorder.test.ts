import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { EventEmitter } from 'events';
import { writeFileSync } from 'fs';

let spawnBehavior: 'close' | 'error' | 'hold' | 'fail' = 'close';
let lastSpawnArgs: { command: string; args: string[] } | null = null;
let lastEmitter: (EventEmitter & { kill: () => void }) | null = null;
let lastOutputPath: string | null = null;
let killCalled = false;
const executableMap = new Map<string, string | null>();

mock.module('../src/voice/utils', () => ({
  findExecutable: (name: string) => executableMap.get(name) ?? null,
  loadApiKeyFromSecrets: () => undefined,
}));

mock.module('child_process', () => ({
  spawn: (command: string, args: string[]) => {
    lastSpawnArgs = { command, args };
    const emitter = new EventEmitter() as EventEmitter & { kill: () => void };
    emitter.kill = () => {
      killCalled = true;
    };
    lastEmitter = emitter;

    const outputPath = args[7] || args[args.length - 1];
    lastOutputPath = outputPath;

    if (spawnBehavior === 'close') {
      writeFileSync(outputPath, Buffer.from([1, 2, 3]));
      setImmediate(() => emitter.emit('close', 0));
    }
    if (spawnBehavior === 'fail') {
      setImmediate(() => emitter.emit('close', 1));
    }
    if (spawnBehavior === 'error') {
      setImmediate(() => emitter.emit('error', new Error('spawn error')));
    }

    return emitter as any;
  },
  spawnSync: () => ({ status: 1, stdout: '' }),
}));

const { AudioRecorder } = await import('../src/voice/recorder');

describe('AudioRecorder', () => {
  beforeEach(() => {
    spawnBehavior = 'close';
    lastSpawnArgs = null;
    lastEmitter = null;
    lastOutputPath = null;
    killCalled = false;
    executableMap.clear();
  });

  afterAll(() => {
    mock.restore();
  });

  test('records audio using sox', async () => {
    executableMap.set('sox', '/usr/bin/sox');

    const recorder = new AudioRecorder();
    const data = await recorder.record({ durationSeconds: 1, sampleRate: 8000, channels: 1 });

    expect(lastSpawnArgs?.command).toBe('/usr/bin/sox');
    expect(data).toBeInstanceOf(ArrayBuffer);
  });

  test('throws when already recording', async () => {
    executableMap.set('sox', '/usr/bin/sox');
    spawnBehavior = 'hold';

    const recorder = new AudioRecorder();
    const first = recorder.record({ durationSeconds: 1 });
    await expect(recorder.record({ durationSeconds: 1 })).rejects.toThrow('already running');

    if (lastOutputPath) {
      writeFileSync(lastOutputPath, Buffer.from([1, 2, 3]));
    }
    lastEmitter?.emit('close', 0);
    await first;
  });

  test('propagates recording failure and errors', async () => {
    executableMap.set('sox', '/usr/bin/sox');
    spawnBehavior = 'fail';

    const recorder = new AudioRecorder();
    await expect(recorder.record()).rejects.toThrow('Audio recording failed');

    spawnBehavior = 'error';
    await expect(recorder.record()).rejects.toThrow('spawn error');
  });

  test('stop kills active process', async () => {
    executableMap.set('sox', '/usr/bin/sox');
    spawnBehavior = 'hold';

    const recorder = new AudioRecorder();
    const pending = recorder.record({ durationSeconds: 1 });

    recorder.stop();
    expect(killCalled).toBe(true);

    if (lastOutputPath) {
      writeFileSync(lastOutputPath, Buffer.from([1, 2, 3]));
    }
    lastEmitter?.emit('close', 0);
    await pending;
  });

  test('throws when no recorder found', async () => {
    executableMap.set('sox', null);
    executableMap.set('ffmpeg', null);
    executableMap.set('arecord', null);

    const recorder = new AudioRecorder();
    await expect(recorder.record()).rejects.toThrow('No supported audio recorder found');
  });

  describe('recordUntilSilence', () => {
    // Helper: wait for spawn to be called then write the output file and close
    function resolveSpawn() {
      if (lastOutputPath) {
        writeFileSync(lastOutputPath, Buffer.from([1, 2, 3]));
      }
      lastEmitter?.emit('close', 0);
    }

    test('records with sox VAD silence detection args', async () => {
      executableMap.set('sox', '/usr/bin/sox');
      spawnBehavior = 'hold';

      const recorder = new AudioRecorder();
      const pending = recorder.recordUntilSilence({ sampleRate: 8000, channels: 1 });

      // Wait a tick for spawn to be called
      await new Promise(r => setTimeout(r, 5));

      expect(lastSpawnArgs?.command).toBe('/usr/bin/sox');
      expect(lastSpawnArgs?.args).toContain('silence');
      expect(lastSpawnArgs?.args).toContain('2.0');
      expect(lastSpawnArgs?.args).toContain('1%');

      resolveSpawn();
      const data = await pending;
      expect(data).toBeInstanceOf(ArrayBuffer);
    });

    test('uses default 30s max duration', async () => {
      executableMap.set('sox', '/usr/bin/sox');
      spawnBehavior = 'hold';

      const recorder = new AudioRecorder();
      const pending = recorder.recordUntilSilence();

      await new Promise(r => setTimeout(r, 5));

      expect(lastSpawnArgs?.args).toContain('30');

      resolveSpawn();
      await pending;
    });

    test('respects custom maxDuration via durationSeconds', async () => {
      executableMap.set('sox', '/usr/bin/sox');
      spawnBehavior = 'hold';

      const recorder = new AudioRecorder();
      const pending = recorder.recordUntilSilence({ durationSeconds: 10 });

      await new Promise(r => setTimeout(r, 5));

      expect(lastSpawnArgs?.args).toContain('10');

      resolveSpawn();
      await pending;
    });

    test('falls back to standard record() when sox not available', async () => {
      executableMap.set('sox', null);
      executableMap.set('ffmpeg', null);
      executableMap.set('arecord', null);

      const recorder = new AudioRecorder();
      await expect(recorder.recordUntilSilence()).rejects.toThrow('No supported audio recorder found');
    });

    test('throws when already recording', async () => {
      executableMap.set('sox', '/usr/bin/sox');
      spawnBehavior = 'hold';

      const recorder = new AudioRecorder();
      const first = recorder.recordUntilSilence();

      await new Promise(r => setTimeout(r, 5));
      await expect(recorder.recordUntilSilence()).rejects.toThrow('already running');

      resolveSpawn();
      await first;
    });

    test('can be stopped via stop()', async () => {
      executableMap.set('sox', '/usr/bin/sox');
      spawnBehavior = 'hold';

      const recorder = new AudioRecorder();
      const pending = recorder.recordUntilSilence();

      await new Promise(r => setTimeout(r, 5));

      recorder.stop();
      expect(killCalled).toBe(true);

      resolveSpawn();
      await pending;
    });

    test('propagates recording failure', async () => {
      executableMap.set('sox', '/usr/bin/sox');
      spawnBehavior = 'fail';

      const recorder = new AudioRecorder();
      await expect(recorder.recordUntilSilence()).rejects.toThrow('Audio recording failed');
    });
  });
});
