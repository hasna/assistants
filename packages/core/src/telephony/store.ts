/**
 * TelephonyStore - SQLite storage for telephony data
 *
 * Manages phone numbers, call logs, SMS logs, and routing rules.
 * Follows the pattern from channels/store.ts.
 */

import { generateId } from '@hasna/assistants-shared';
import { getDatabase } from '../database';
import type { DatabaseConnection } from '../runtime';
import type {
  PhoneNumber,
  PhoneNumberStatus,
  CallLog,
  CallStatus,
  CallDirection,
  SmsLog,
  SmsStatus,
  SmsDirection,
  MessageType,
  RoutingRule,
  CallListItem,
  SmsListItem,
} from './types';

function generatePhoneId(): string {
  return `ph_${generateId().slice(0, 12)}`;
}

function generateCallId(): string {
  return `call_${generateId().slice(0, 12)}`;
}

function generateSmsId(): string {
  return `sms_${generateId().slice(0, 12)}`;
}

function generateRuleId(): string {
  return `rule_${generateId().slice(0, 12)}`;
}

/**
 * TelephonyStore manages all telephony data in SQLite
 */
export class TelephonyStore {
  private db: DatabaseConnection;

  constructor(db?: DatabaseConnection) {
    this.db = db || getDatabase();
  }

  private getSetting(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM telephony_settings WHERE key = ?').get(key) as { value?: string } | undefined;
    return row?.value ?? null;
  }

  private setSetting(key: string, value: string): void {
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO telephony_settings (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).run(key, value, now);
  }

  getDefaultPhoneNumber(): string | null {
    return this.getSetting('default_phone_number');
  }

  setDefaultPhoneNumber(number: string): void {
    this.setSetting('default_phone_number', number);
  }

  // ============================================
  // Phone Numbers
  // ============================================

  addPhoneNumber(
    number: string,
    friendlyName: string | null,
    twilioSid: string | null,
    capabilities?: { voice?: boolean; sms?: boolean; whatsapp?: boolean }
  ): PhoneNumber {
    const id = generatePhoneId();
    const now = new Date().toISOString();

    this.db.prepare(
      `INSERT INTO phone_numbers (id, number, friendly_name, twilio_sid, voice_capable, sms_capable, whatsapp_capable, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, number, friendlyName, twilioSid,
      capabilities?.voice !== false ? 1 : 0,
      capabilities?.sms !== false ? 1 : 0,
      capabilities?.whatsapp ? 1 : 0,
      now, now
    );

    return this.getPhoneNumber(id)!;
  }

  getPhoneNumber(id: string): PhoneNumber | null {
    const row = this.db.prepare('SELECT * FROM phone_numbers WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToPhoneNumber(row) : null;
  }

  getPhoneNumberByNumber(number: string): PhoneNumber | null {
    const row = this.db.prepare('SELECT * FROM phone_numbers WHERE number = ?').get(number) as Record<string, unknown> | undefined;
    return row ? this.rowToPhoneNumber(row) : null;
  }

  listPhoneNumbers(status?: PhoneNumberStatus): PhoneNumber[] {
    let query = 'SELECT * FROM phone_numbers';
    const params: unknown[] = [];

    if (status) {
      query += ' WHERE status = ?';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC';
    const rows = this.db.prepare(query).all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.rowToPhoneNumber(r));
  }

  updatePhoneNumberStatus(id: string, status: PhoneNumberStatus): boolean {
    const now = new Date().toISOString();
    const result = this.db.prepare(
      'UPDATE phone_numbers SET status = ?, updated_at = ? WHERE id = ?'
    ).run(status, now, id);
    return (result as { changes: number }).changes > 0;
  }

  deletePhoneNumber(id: string): boolean {
    const result = this.db.prepare('DELETE FROM phone_numbers WHERE id = ?').run(id);
    return (result as { changes: number }).changes > 0;
  }

  // ============================================
  // Call Logs
  // ============================================

  createCallLog(params: {
    callSid?: string;
    fromNumber: string;
    toNumber: string;
    direction: CallDirection;
    status?: CallStatus;
    assistantId?: string;
  }): CallLog {
    const id = generateCallId();
    const now = new Date().toISOString();

    this.db.prepare(
      `INSERT INTO call_logs (id, call_sid, from_number, to_number, direction, status, assistant_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, params.callSid || null, params.fromNumber, params.toNumber,
      params.direction, params.status || 'pending', params.assistantId || null, now
    );

    return this.getCallLog(id)!;
  }

  getCallLog(id: string): CallLog | null {
    const row = this.db.prepare('SELECT * FROM call_logs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToCallLog(row) : null;
  }

  getCallLogBySid(callSid: string): CallLog | null {
    const row = this.db.prepare('SELECT * FROM call_logs WHERE call_sid = ?').get(callSid) as Record<string, unknown> | undefined;
    return row ? this.rowToCallLog(row) : null;
  }

  updateCallLog(id: string, updates: {
    status?: CallStatus;
    callSid?: string;
    duration?: number;
    recordingUrl?: string;
    startedAt?: string;
    endedAt?: string;
  }): boolean {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (updates.status !== undefined) { sets.push('status = ?'); params.push(updates.status); }
    if (updates.callSid !== undefined) { sets.push('call_sid = ?'); params.push(updates.callSid); }
    if (updates.duration !== undefined) { sets.push('duration = ?'); params.push(updates.duration); }
    if (updates.recordingUrl !== undefined) { sets.push('recording_url = ?'); params.push(updates.recordingUrl); }
    if (updates.startedAt !== undefined) { sets.push('started_at = ?'); params.push(updates.startedAt); }
    if (updates.endedAt !== undefined) { sets.push('ended_at = ?'); params.push(updates.endedAt); }

    if (sets.length === 0) return false;

    params.push(id);
    const result = this.db.prepare(
      `UPDATE call_logs SET ${sets.join(', ')} WHERE id = ?`
    ).run(...params);
    return (result as { changes: number }).changes > 0;
  }

  listCallLogs(options?: {
    assistantId?: string;
    direction?: CallDirection;
    status?: CallStatus;
    limit?: number;
  }): CallListItem[] {
    const conditions: string[] = [];
    const params: unknown[] = [];
    const limit = options?.limit || 50;

    if (options?.assistantId) {
      conditions.push('assistant_id = ?');
      params.push(options.assistantId);
    }
    if (options?.direction) {
      conditions.push('direction = ?');
      params.push(options.direction);
    }
    if (options?.status) {
      conditions.push('status = ?');
      params.push(options.status);
    }

    let query = 'SELECT * FROM call_logs';
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const rows = this.db.prepare(query).all(...params) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: String(row.id),
      fromNumber: String(row.from_number),
      toNumber: String(row.to_number),
      direction: String(row.direction) as CallDirection,
      status: String(row.status) as CallStatus,
      duration: row.duration != null ? Number(row.duration) : null,
      startedAt: row.started_at ? String(row.started_at) : null,
      createdAt: String(row.created_at),
      assistantId: row.assistant_id ? String(row.assistant_id) : null,
    }));
  }

  // ============================================
  // SMS Logs
  // ============================================

  createSmsLog(params: {
    messageSid?: string;
    fromNumber: string;
    toNumber: string;
    direction: SmsDirection;
    messageType?: MessageType;
    body: string;
    status?: SmsStatus;
    assistantId?: string;
  }): SmsLog {
    const id = generateSmsId();
    const now = new Date().toISOString();

    this.db.prepare(
      `INSERT INTO sms_logs (id, message_sid, from_number, to_number, direction, message_type, body, status, assistant_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, params.messageSid || null, params.fromNumber, params.toNumber,
      params.direction, params.messageType || 'sms', params.body,
      params.status || 'queued', params.assistantId || null, now
    );

    return this.getSmsLog(id)!;
  }

  getSmsLog(id: string): SmsLog | null {
    const row = this.db.prepare('SELECT * FROM sms_logs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToSmsLog(row) : null;
  }

  updateSmsStatus(id: string, status: SmsStatus): boolean {
    const result = this.db.prepare(
      'UPDATE sms_logs SET status = ? WHERE id = ?'
    ).run(status, id);
    return (result as { changes: number }).changes > 0;
  }

  listSmsLogs(options?: {
    assistantId?: string;
    direction?: SmsDirection;
    messageType?: MessageType;
    limit?: number;
  }): SmsListItem[] {
    const conditions: string[] = [];
    const params: unknown[] = [];
    const limit = options?.limit || 50;

    if (options?.assistantId) {
      conditions.push('assistant_id = ?');
      params.push(options.assistantId);
    }
    if (options?.direction) {
      conditions.push('direction = ?');
      params.push(options.direction);
    }
    if (options?.messageType) {
      conditions.push('message_type = ?');
      params.push(options.messageType);
    }

    let query = 'SELECT * FROM sms_logs';
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const rows = this.db.prepare(query).all(...params) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: String(row.id),
      fromNumber: String(row.from_number),
      toNumber: String(row.to_number),
      direction: String(row.direction) as SmsDirection,
      messageType: String(row.message_type) as MessageType,
      bodyPreview: String(row.body).slice(0, 100),
      status: String(row.status) as SmsStatus,
      createdAt: String(row.created_at),
      assistantId: row.assistant_id ? String(row.assistant_id) : null,
    }));
  }

  getUnreadInboundSms(assistantId: string, limit?: number): SmsLog[] {
    const maxLimit = limit || 50;
    const rows = this.db.prepare(
      `SELECT * FROM sms_logs
       WHERE direction = 'inbound' AND assistant_id = ? AND status = 'received'
       ORDER BY created_at ASC LIMIT ?`
    ).all(assistantId, maxLimit) as Record<string, unknown>[];
    return rows.map((r) => this.rowToSmsLog(r));
  }

  // ============================================
  // Routing Rules
  // ============================================

  createRoutingRule(params: {
    name: string;
    priority?: number;
    fromPattern?: string;
    toPattern?: string;
    messageType?: MessageType | 'voice' | 'all';
    timeOfDay?: string;
    dayOfWeek?: string;
    keyword?: string;
    targetAssistantId: string;
    targetAssistantName: string;
  }): RoutingRule {
    const id = generateRuleId();
    const now = new Date().toISOString();

    this.db.prepare(
      `INSERT INTO routing_rules (id, name, priority, from_pattern, to_pattern, message_type, time_of_day, day_of_week, keyword, target_assistant_id, target_assistant_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, params.name, params.priority ?? 100,
      params.fromPattern || null, params.toPattern || null,
      params.messageType || 'all',
      params.timeOfDay || null, params.dayOfWeek || null,
      params.keyword || null,
      params.targetAssistantId, params.targetAssistantName,
      now, now
    );

    return this.getRoutingRule(id)!;
  }

  getRoutingRule(id: string): RoutingRule | null {
    const row = this.db.prepare('SELECT * FROM routing_rules WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToRoutingRule(row) : null;
  }

  listRoutingRules(): RoutingRule[] {
    const rows = this.db.prepare(
      'SELECT * FROM routing_rules ORDER BY priority ASC, created_at ASC'
    ).all() as Record<string, unknown>[];
    return rows.map((r) => this.rowToRoutingRule(r));
  }

  updateRoutingRule(id: string, updates: {
    name?: string;
    priority?: number;
    enabled?: boolean;
  }): boolean {
    const sets: string[] = [];
    const params: unknown[] = [];
    const now = new Date().toISOString();

    if (updates.name !== undefined) { sets.push('name = ?'); params.push(updates.name); }
    if (updates.priority !== undefined) { sets.push('priority = ?'); params.push(updates.priority); }
    if (updates.enabled !== undefined) { sets.push('enabled = ?'); params.push(updates.enabled ? 1 : 0); }

    sets.push('updated_at = ?');
    params.push(now);

    if (sets.length === 1) return false; // Only updated_at

    params.push(id);
    const result = this.db.prepare(
      `UPDATE routing_rules SET ${sets.join(', ')} WHERE id = ?`
    ).run(...params);
    return (result as { changes: number }).changes > 0;
  }

  deleteRoutingRule(id: string): boolean {
    const result = this.db.prepare('DELETE FROM routing_rules WHERE id = ?').run(id);
    return (result as { changes: number }).changes > 0;
  }

  /**
   * Resolve which assistant should handle an incoming event based on routing rules.
   * Returns the first matching rule's target assistant, or null if no match.
   */
  resolveRouting(params: {
    fromNumber: string;
    toNumber: string;
    messageType: MessageType | 'voice';
    body?: string;
  }): { assistantId: string; assistantName: string; ruleId: string } | null {
    const rules = this.db.prepare(
      `SELECT * FROM routing_rules WHERE enabled = 1 ORDER BY priority ASC`
    ).all() as Record<string, unknown>[];

    for (const row of rules) {
      const rule = this.rowToRoutingRule(row);

      // Check message type
      if (rule.messageType !== 'all' && rule.messageType !== params.messageType) continue;

      // Check from pattern (simple glob: * = any, +1234* = prefix match)
      if (rule.fromPattern && !matchPattern(rule.fromPattern, params.fromNumber)) continue;

      // Check to pattern
      if (rule.toPattern && !matchPattern(rule.toPattern, params.toNumber)) continue;

      // Check keyword in body
      if (rule.keyword && params.body) {
        if (!params.body.toLowerCase().includes(rule.keyword.toLowerCase())) continue;
      } else if (rule.keyword && !params.body) {
        continue;
      }

      // Check time of day (format: "09:00-17:00")
      if (rule.timeOfDay && !matchTimeOfDay(rule.timeOfDay)) continue;

      // Check day of week (format: "mon,tue,wed,thu,fri")
      if (rule.dayOfWeek && !matchDayOfWeek(rule.dayOfWeek)) continue;

      return {
        assistantId: rule.targetAssistantId,
        assistantName: rule.targetAssistantName,
        ruleId: rule.id,
      };
    }

    return null;
  }

  // ============================================
  // Cleanup
  // ============================================

  cleanup(maxAgeDays: number, maxCallLogs: number, maxSmsLogs: number): number {
    let deleted = 0;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - maxAgeDays);
    const cutoffStr = cutoff.toISOString();

    // Delete old call logs
    const callResult = this.db.prepare(
      'DELETE FROM call_logs WHERE created_at < ?'
    ).run(cutoffStr);
    deleted += (callResult as { changes: number }).changes;

    // Delete old SMS logs
    const smsResult = this.db.prepare(
      'DELETE FROM sms_logs WHERE created_at < ?'
    ).run(cutoffStr);
    deleted += (smsResult as { changes: number }).changes;

    // Enforce call log limit
    const callCount = (this.db.prepare('SELECT COUNT(*) as cnt FROM call_logs').get() as Record<string, unknown>);
    if (Number(callCount.cnt) > maxCallLogs) {
      const excess = Number(callCount.cnt) - maxCallLogs;
      const trimResult = this.db.prepare(
        `DELETE FROM call_logs WHERE id IN (
          SELECT id FROM call_logs ORDER BY created_at ASC LIMIT ?
        )`
      ).run(excess);
      deleted += (trimResult as { changes: number }).changes;
    }

    // Enforce SMS log limit
    const smsCount = (this.db.prepare('SELECT COUNT(*) as cnt FROM sms_logs').get() as Record<string, unknown>);
    if (Number(smsCount.cnt) > maxSmsLogs) {
      const excess = Number(smsCount.cnt) - maxSmsLogs;
      const trimResult = this.db.prepare(
        `DELETE FROM sms_logs WHERE id IN (
          SELECT id FROM sms_logs ORDER BY created_at ASC LIMIT ?
        )`
      ).run(excess);
      deleted += (trimResult as { changes: number }).changes;
    }

    return deleted;
  }

  close(): void { }

  // ============================================
  // Row Mappers
  // ============================================

  private rowToPhoneNumber(row: Record<string, unknown>): PhoneNumber {
    return {
      id: String(row.id),
      number: String(row.number),
      friendlyName: row.friendly_name ? String(row.friendly_name) : null,
      twilioSid: row.twilio_sid ? String(row.twilio_sid) : null,
      status: String(row.status) as PhoneNumberStatus,
      capabilities: {
        voice: Boolean(row.voice_capable),
        sms: Boolean(row.sms_capable),
        whatsapp: Boolean(row.whatsapp_capable),
      },
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private rowToCallLog(row: Record<string, unknown>): CallLog {
    return {
      id: String(row.id),
      callSid: row.call_sid ? String(row.call_sid) : null,
      fromNumber: String(row.from_number),
      toNumber: String(row.to_number),
      direction: String(row.direction) as CallDirection,
      status: String(row.status) as CallStatus,
      assistantId: row.assistant_id ? String(row.assistant_id) : null,
      duration: row.duration != null ? Number(row.duration) : null,
      recordingUrl: row.recording_url ? String(row.recording_url) : null,
      startedAt: row.started_at ? String(row.started_at) : null,
      endedAt: row.ended_at ? String(row.ended_at) : null,
      createdAt: String(row.created_at),
    };
  }

  private rowToSmsLog(row: Record<string, unknown>): SmsLog {
    return {
      id: String(row.id),
      messageSid: row.message_sid ? String(row.message_sid) : null,
      fromNumber: String(row.from_number),
      toNumber: String(row.to_number),
      direction: String(row.direction) as SmsDirection,
      messageType: String(row.message_type) as MessageType,
      body: String(row.body),
      status: String(row.status) as SmsStatus,
      assistantId: row.assistant_id ? String(row.assistant_id) : null,
      createdAt: String(row.created_at),
    };
  }

  private rowToRoutingRule(row: Record<string, unknown>): RoutingRule {
    return {
      id: String(row.id),
      name: String(row.name),
      priority: Number(row.priority),
      fromPattern: row.from_pattern ? String(row.from_pattern) : null,
      toPattern: row.to_pattern ? String(row.to_pattern) : null,
      messageType: String(row.message_type) as MessageType | 'voice' | 'all',
      timeOfDay: row.time_of_day ? String(row.time_of_day) : null,
      dayOfWeek: row.day_of_week ? String(row.day_of_week) : null,
      keyword: row.keyword ? String(row.keyword) : null,
      targetAssistantId: String(row.target_assistant_id),
      targetAssistantName: String(row.target_assistant_name),
      enabled: Boolean(row.enabled),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }
}

// ============================================
// Pattern Matching Helpers
// ============================================

/**
 * Simple pattern matching for phone numbers.
 * Supports: * (match all), +1234* (prefix), *1234 (suffix), exact match
 */
function matchPattern(pattern: string, value: string): boolean {
  if (pattern === '*') return true;
  if (pattern.endsWith('*')) {
    return value.startsWith(pattern.slice(0, -1));
  }
  if (pattern.startsWith('*')) {
    return value.endsWith(pattern.slice(1));
  }
  return pattern === value;
}

/**
 * Check if current time matches a time range (e.g., "09:00-17:00")
 */
function matchTimeOfDay(timeRange: string): boolean {
  const [start, end] = timeRange.split('-');
  if (!start || !end) return true;

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const [startH, startM] = start.split(':').map(Number);
  const [endH, endM] = end.split(':').map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  }
  // Handle overnight ranges (e.g., "22:00-06:00")
  return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
}

/**
 * Check if current day matches a comma-separated day list (e.g., "mon,tue,wed")
 */
function matchDayOfWeek(dayList: string): boolean {
  const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const today = days[new Date().getDay()];
  const allowedDays = dayList.toLowerCase().split(',').map((d) => d.trim());
  return allowedDays.includes(today);
}
