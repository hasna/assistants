import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { TelephonyManager } from '../src/telephony/manager';
import { CallManager } from '../src/telephony/call-manager';
import type { TelephonyConfig } from '../src/telephony/types';
import { closeDatabase, resetDatabaseSingleton } from '../src/database';

describe('TelephonyManager defaults', () => {
  let tempDir: string;
  let originalAssistantsDir: string | undefined;
  let originalTwilioNumber: string | undefined;

  beforeEach(async () => {
    originalAssistantsDir = process.env.ASSISTANTS_DIR;
    originalTwilioNumber = process.env.TWILIO_PHONE_NUMBER;
    tempDir = await mkdtemp(join(tmpdir(), 'telephony-manager-test-'));
    process.env.ASSISTANTS_DIR = tempDir;
    resetDatabaseSingleton();
    delete process.env.TWILIO_PHONE_NUMBER;
  });

  afterEach(async () => {
    closeDatabase();
    resetDatabaseSingleton();
    if (originalAssistantsDir === undefined) {
      delete process.env.ASSISTANTS_DIR;
    } else {
      process.env.ASSISTANTS_DIR = originalAssistantsDir;
    }
    if (originalTwilioNumber === undefined) {
      delete process.env.TWILIO_PHONE_NUMBER;
    } else {
      process.env.TWILIO_PHONE_NUMBER = originalTwilioNumber;
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  const createManager = (config: TelephonyConfig) => {
    return new TelephonyManager({
      assistantId: 'assistant-test',
      assistantName: 'Test Assistant',
      config,
    });
  };

  it('prefers config default phone number', () => {
    process.env.TWILIO_PHONE_NUMBER = '+19990001111';
    const manager = createManager({
      enabled: true,
      defaultPhoneNumber: '+12223334444',
    });

    const status = manager.getStatus();
    expect(status.defaultPhoneNumber).toBe('+12223334444');
    expect(status.defaultPhoneNumberSource).toBe('config');
    manager.close();
  });

  it('uses local default phone number over env', () => {
    process.env.TWILIO_PHONE_NUMBER = '+19990001111';
    const manager = createManager({ enabled: true });

    const result = manager.setDefaultPhoneNumber('+14445556666');
    expect(result.success).toBe(true);

    const status = manager.getStatus();
    expect(status.defaultPhoneNumber).toBe('+14445556666');
    expect(status.defaultPhoneNumberSource).toBe('local');
    manager.close();
  });

  it('falls back to env default phone number', () => {
    process.env.TWILIO_PHONE_NUMBER = '+17778889999';
    const manager = createManager({ enabled: true });

    const status = manager.getStatus();
    expect(status.defaultPhoneNumber).toBe('+17778889999');
    expect(status.defaultPhoneNumberSource).toBe('env');
    manager.close();
  });
});

describe('CallManager state transitions with on-hold', () => {
  let callManager: CallManager;

  beforeEach(() => {
    callManager = new CallManager();
  });

  it('transitions active → on-hold', () => {
    callManager.addCall({
      callSid: 'CA001',
      fromNumber: '+15551110000',
      toNumber: '+15552220000',
      direction: 'outbound',
    });
    // Move to active
    expect(callManager.updateState('CA001', 'active')).toBe(true);
    expect(callManager.getCall('CA001')?.state).toBe('active');
    // Move to on-hold
    expect(callManager.updateState('CA001', 'on-hold')).toBe(true);
    expect(callManager.getCall('CA001')?.state).toBe('on-hold');
  });

  it('transitions on-hold → active', () => {
    callManager.addCall({
      callSid: 'CA002',
      fromNumber: '+15551110000',
      toNumber: '+15552220000',
      direction: 'outbound',
    });
    callManager.updateState('CA002', 'active');
    callManager.updateState('CA002', 'on-hold');
    // Resume
    expect(callManager.updateState('CA002', 'active')).toBe(true);
    expect(callManager.getCall('CA002')?.state).toBe('active');
  });

  it('transitions on-hold → ending', () => {
    callManager.addCall({
      callSid: 'CA003',
      fromNumber: '+15551110000',
      toNumber: '+15552220000',
      direction: 'outbound',
    });
    callManager.updateState('CA003', 'active');
    callManager.updateState('CA003', 'on-hold');
    // End from hold
    expect(callManager.updateState('CA003', 'ending')).toBe(true);
    expect(callManager.getCall('CA003')?.state).toBe('ending');
  });

  it('rejects invalid transition connecting → on-hold', () => {
    callManager.addCall({
      callSid: 'CA004',
      fromNumber: '+15551110000',
      toNumber: '+15552220000',
      direction: 'outbound',
    });
    expect(callManager.getCall('CA004')?.state).toBe('connecting');
    expect(callManager.updateState('CA004', 'on-hold')).toBe(false);
    expect(callManager.getCall('CA004')?.state).toBe('connecting');
  });

  it('rejects invalid transition ringing → on-hold', () => {
    callManager.addCall({
      callSid: 'CA005',
      fromNumber: '+15551110000',
      toNumber: '+15552220000',
      direction: 'outbound',
    });
    callManager.updateState('CA005', 'ringing');
    expect(callManager.updateState('CA005', 'on-hold')).toBe(false);
    expect(callManager.getCall('CA005')?.state).toBe('ringing');
  });

  it('rejects invalid transition bridging → on-hold', () => {
    callManager.addCall({
      callSid: 'CA006',
      fromNumber: '+15551110000',
      toNumber: '+15552220000',
      direction: 'outbound',
    });
    callManager.updateState('CA006', 'ringing');
    callManager.updateState('CA006', 'bridging');
    expect(callManager.updateState('CA006', 'on-hold')).toBe(false);
    expect(callManager.getCall('CA006')?.state).toBe('bridging');
  });

  it('preserves existing state transitions (connecting → ringing → bridging → active → ending)', () => {
    callManager.addCall({
      callSid: 'CA007',
      fromNumber: '+15551110000',
      toNumber: '+15552220000',
      direction: 'inbound',
    });
    expect(callManager.updateState('CA007', 'ringing')).toBe(true);
    expect(callManager.updateState('CA007', 'bridging')).toBe(true);
    expect(callManager.updateState('CA007', 'active')).toBe(true);
    expect(callManager.updateState('CA007', 'ending')).toBe(true);
    expect(callManager.getCall('CA007')?.state).toBe('ending');
  });

  it('endCall returns call and removes it', () => {
    callManager.addCall({
      callSid: 'CA008',
      fromNumber: '+15551110000',
      toNumber: '+15552220000',
      direction: 'outbound',
    });
    const ended = callManager.endCall('CA008');
    expect(ended).not.toBeNull();
    expect(ended!.callSid).toBe('CA008');
    expect(callManager.getCall('CA008')).toBeNull();
  });

  it('getCallDuration returns seconds since start', () => {
    callManager.addCall({
      callSid: 'CA009',
      fromNumber: '+15551110000',
      toNumber: '+15552220000',
      direction: 'outbound',
    });
    const duration = callManager.getCallDuration('CA009');
    expect(duration).not.toBeNull();
    expect(duration!).toBeGreaterThanOrEqual(0);
    expect(duration!).toBeLessThan(5); // should be near-instant in test
  });
});

describe('TelephonyManager hold/resume/endCall', () => {
  let tempDir: string;
  let originalAssistantsDir: string | undefined;

  beforeEach(async () => {
    originalAssistantsDir = process.env.ASSISTANTS_DIR;
    tempDir = await mkdtemp(join(tmpdir(), 'telephony-hold-test-'));
    process.env.ASSISTANTS_DIR = tempDir;
  });

  afterEach(async () => {
    if (originalAssistantsDir === undefined) {
      delete process.env.ASSISTANTS_DIR;
    } else {
      process.env.ASSISTANTS_DIR = originalAssistantsDir;
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  it('holdCall returns error when no active call (no calls exist)', async () => {
    const manager = new TelephonyManager({
      assistantId: 'test',
      assistantName: 'Test',
      config: { enabled: true },
    });
    const result = await manager.holdCall();
    expect(result.success).toBe(false);
    expect(result.message).toContain('No active call');
    manager.close();
  });

  it('holdCall returns error when specific call not found', async () => {
    const manager = new TelephonyManager({
      assistantId: 'test',
      assistantName: 'Test',
      config: { enabled: true },
    });
    const result = await manager.holdCall('nonexistent');
    expect(result.success).toBe(false);
    expect(result.message).toContain('not found');
    manager.close();
  });

  it('resumeCall returns error when no held call', async () => {
    const manager = new TelephonyManager({
      assistantId: 'test',
      assistantName: 'Test',
      config: { enabled: true },
    });
    const result = await manager.resumeCall();
    expect(result.success).toBe(false);
    expect(result.message).toContain('No held call');
    manager.close();
  });

  it('endCall returns error when no active call', async () => {
    const manager = new TelephonyManager({
      assistantId: 'test',
      assistantName: 'Test',
      config: { enabled: true },
    });
    const result = await manager.endCall();
    expect(result.success).toBe(false);
    expect(result.message).toContain('No active call');
    manager.close();
  });

  it('getActiveCalls returns empty when no calls', () => {
    const manager = new TelephonyManager({
      assistantId: 'test',
      assistantName: 'Test',
      config: { enabled: true },
    });
    const calls = manager.getActiveCalls();
    expect(calls).toEqual([]);
    manager.close();
  });

  it('getActiveCalls returns calls with duration', () => {
    const manager = new TelephonyManager({
      assistantId: 'test',
      assistantName: 'Test',
      config: { enabled: true },
    });
    // Add a call via the call manager
    const callManager = manager.getCallManager();
    callManager.addCall({
      callSid: 'CA100',
      fromNumber: '+15551110000',
      toNumber: '+15552220000',
      direction: 'outbound',
    });
    callManager.updateState('CA100', 'active');

    const calls = manager.getActiveCalls();
    expect(calls.length).toBe(1);
    expect(calls[0].callSid).toBe('CA100');
    expect(calls[0].state).toBe('active');
    expect(calls[0].durationSeconds).toBeGreaterThanOrEqual(0);
    manager.close();
  });

  it('startStreamServer throws when voice bridge not configured', () => {
    const manager = new TelephonyManager({
      assistantId: 'test',
      assistantName: 'Test',
      config: { enabled: true },
    });
    // No ElevenLabs configured → no voice bridge
    expect(() => manager.startStreamServer()).toThrow('Voice bridge is not configured');
    manager.close();
  });
});
