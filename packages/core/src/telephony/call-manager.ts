/**
 * CallManager - Active call state machine (in-memory)
 *
 * Tracks active calls and their state transitions.
 * This is separate from the SQLite store which handles persistent logs.
 */

import type { ActiveCall, ActiveCallState, CallDirection } from './types';

export interface CallManagerConfig {
  /** Max call duration in seconds (default: 3600) */
  maxCallDurationSeconds?: number;
  /** Stale call timeout in seconds (default: 300) */
  staleTimeoutSeconds?: number;
}

/**
 * CallManager tracks active calls in memory
 */
export class CallManager {
  private activeCalls = new Map<string, ActiveCall>();
  private maxCallDurationMs: number;
  private staleTimeoutMs: number;

  constructor(config?: CallManagerConfig) {
    this.maxCallDurationMs = (config?.maxCallDurationSeconds || 3600) * 1000;
    this.staleTimeoutMs = (config?.staleTimeoutSeconds || 300) * 1000;
  }

  /**
   * Register a new active call
   */
  addCall(params: {
    callSid: string;
    fromNumber: string;
    toNumber: string;
    direction: CallDirection;
    assistantId?: string;
  }): ActiveCall {
    const call: ActiveCall = {
      callSid: params.callSid,
      streamSid: null,
      fromNumber: params.fromNumber,
      toNumber: params.toNumber,
      direction: params.direction,
      state: 'connecting',
      assistantId: params.assistantId || null,
      bridgeId: null,
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
    };

    this.activeCalls.set(params.callSid, call);
    return call;
  }

  /**
   * Get an active call by SID
   */
  getCall(callSid: string): ActiveCall | null {
    return this.activeCalls.get(callSid) || null;
  }

  /**
   * Update call state
   */
  updateState(callSid: string, state: ActiveCallState): boolean {
    const call = this.activeCalls.get(callSid);
    if (!call) return false;

    // Validate state transitions
    const validTransitions: Record<ActiveCallState, ActiveCallState[]> = {
      connecting: ['ringing', 'active', 'ending'],
      ringing: ['bridging', 'active', 'ending'],
      bridging: ['active', 'ending'],
      active: ['on-hold', 'ending'],
      'on-hold': ['active', 'ending'],
      ending: [], // Terminal state
    };

    if (!validTransitions[call.state].includes(state)) {
      return false;
    }

    call.state = state;
    call.lastActivityAt = Date.now();
    return true;
  }

  /**
   * Set the stream SID for a call (when media stream starts)
   */
  setStreamSid(callSid: string, streamSid: string): boolean {
    const call = this.activeCalls.get(callSid);
    if (!call) return false;

    call.streamSid = streamSid;
    call.lastActivityAt = Date.now();
    return true;
  }

  /**
   * Set the bridge ID for a call (when ElevenLabs bridge connects)
   */
  setBridgeId(callSid: string, bridgeId: string): boolean {
    const call = this.activeCalls.get(callSid);
    if (!call) return false;

    call.bridgeId = bridgeId;
    call.lastActivityAt = Date.now();
    return true;
  }

  /**
   * Update the last activity timestamp (keeps call alive)
   */
  touchCall(callSid: string): void {
    const call = this.activeCalls.get(callSid);
    if (call) {
      call.lastActivityAt = Date.now();
    }
  }

  /**
   * End a call and remove from active tracking
   */
  endCall(callSid: string): ActiveCall | null {
    const call = this.activeCalls.get(callSid);
    if (!call) return null;

    call.state = 'ending';
    this.activeCalls.delete(callSid);
    return call;
  }

  /**
   * Get all active calls
   */
  getActiveCalls(): ActiveCall[] {
    return Array.from(this.activeCalls.values());
  }

  /**
   * Get active call count
   */
  getActiveCallCount(): number {
    return this.activeCalls.size;
  }

  /**
   * Find a call by stream SID
   */
  getCallByStreamSid(streamSid: string): ActiveCall | null {
    for (const call of this.activeCalls.values()) {
      if (call.streamSid === streamSid) return call;
    }
    return null;
  }

  /**
   * Clean up stale and expired calls
   */
  cleanupStaleCalls(): string[] {
    const now = Date.now();
    const removed: string[] = [];

    for (const [callSid, call] of this.activeCalls) {
      // Remove calls that exceeded max duration
      if (now - call.startedAt > this.maxCallDurationMs) {
        this.activeCalls.delete(callSid);
        removed.push(callSid);
        continue;
      }

      // Remove stale calls (no activity for staleTimeout)
      if (now - call.lastActivityAt > this.staleTimeoutMs) {
        this.activeCalls.delete(callSid);
        removed.push(callSid);
      }
    }

    return removed;
  }

  /**
   * Get call duration in seconds
   */
  getCallDuration(callSid: string): number | null {
    const call = this.activeCalls.get(callSid);
    if (!call) return null;
    return Math.floor((Date.now() - call.startedAt) / 1000);
  }

  /**
   * End all active calls
   */
  endAllCalls(): ActiveCall[] {
    const calls = Array.from(this.activeCalls.values());
    this.activeCalls.clear();
    return calls;
  }
}
