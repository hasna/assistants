import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { EventEmitter } from 'events';

let spawnBehavior: 'close' | 'error' | 'hold' = 'close';
let lastSpawnArgs: { command: string; args: string[] } | null = null;
let lastEmitter: (EventEmitter & { kill: () => void }) | null = null;
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

    if (spawnBehavior === 'close') {
      setImmediate(() => emitter.emit('close'));
    }
    if (spawnBehavior === 'error') {
      setImmediate(() => emitter.emit('error', new Error('spawn error')));
    }

    return emitter as any;
  },
  spawnSync: () => ({ status: 1, stdout: '' }),
}));

const { AudioPlayer } = await import('../src/voice/player');

describe('AudioPlayer', () => {
  beforeEach(() => {
    spawnBehavior = 'close';
    lastSpawnArgs = null;
    lastEmitter = null;
    killCalled = false;
    executableMap.clear();
  });

  afterAll(() => {
    mock.restore();
  });

  test('plays audio using resolved player', async () => {
    executableMap.set('afplay', null);
    executableMap.set('ffplay', '/usr/bin/ffplay');

    const player = new AudioPlayer();
    const audio = new Uint8Array([1, 2, 3]).buffer;
    await player.play(audio, { format: 'mp3' });

    expect(lastSpawnArgs?.command).toBe('/usr/bin/ffplay');
    expect(lastSpawnArgs?.args).toContain('-nodisp');
    expect(player.isPlaying()).toBe(false);
  });

  test('plays streamed audio', async () => {
    executableMap.set('afplay', null);
    executableMap.set('ffplay', '/usr/bin/ffplay');

    const player = new AudioPlayer();
    async function* chunks() {
      yield new Uint8Array([1]).buffer;
      yield new Uint8Array([2]).buffer;
    }

    await player.playStream(chunks(), { format: 'mp3' });
    expect(lastSpawnArgs?.command).toBe('/usr/bin/ffplay');
  });

  test('throws when no player found', async () => {
    executableMap.set('afplay', null);
    executableMap.set('ffplay', null);
    executableMap.set('mpg123', null);
    executableMap.set('aplay', null);

    const player = new AudioPlayer();
    const audio = new Uint8Array([1, 2, 3]).buffer;
    await expect(player.play(audio)).rejects.toThrow('No supported audio player found');
  });

  test('stop kills active process', async () => {
    executableMap.set('afplay', null);
    executableMap.set('ffplay', '/usr/bin/ffplay');
    spawnBehavior = 'hold';

    const player = new AudioPlayer();
    const audio = new Uint8Array([1, 2, 3]).buffer;
    const playPromise = player.play(audio);

    player.stop();
    expect(killCalled).toBe(true);
    lastEmitter?.emit('close');
    await playPromise.catch(() => {});
  });

  test('propagates spawn errors', async () => {
    executableMap.set('afplay', null);
    executableMap.set('ffplay', '/usr/bin/ffplay');
    spawnBehavior = 'error';

    const player = new AudioPlayer();
    const audio = new Uint8Array([1, 2, 3]).buffer;
    await expect(player.play(audio)).rejects.toThrow('spawn error');
  });
});
