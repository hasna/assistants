/**
 * Telephony types
 * Types for Twilio telephony integration with ElevenLabs Conversational AI
 */

import type { TelephonyConfig } from '@hasna/assistants-shared';

// Re-export shared config type
export type { TelephonyConfig };

// ============================================
// Status Types
// ============================================

export type CallStatus = 'pending' | 'ringing' | 'in-progress' | 'completed' | 'failed' | 'busy' | 'no-answer' | 'canceled';
export type CallDirection = 'inbound' | 'outbound';
export type SmsDirection = 'inbound' | 'outbound';
export type SmsStatus = 'queued' | 'sent' | 'delivered' | 'failed' | 'received';
export type PhoneNumberStatus = 'active' | 'inactive';
export type MessageType = 'sms' | 'whatsapp';

// ============================================
// Core Types
// ============================================

/**
 * A phone number managed by the system
 */
export interface PhoneNumber {
  id: string;
  number: string;
  friendlyName: string | null;
  twilioSid: string | null;
  status: PhoneNumberStatus;
  capabilities: PhoneNumberCapabilities;
  createdAt: string;
  updatedAt: string;
}

export interface PhoneNumberCapabilities {
  voice: boolean;
  sms: boolean;
  whatsapp: boolean;
}

/**
 * A call log entry
 */
export interface CallLog {
  id: string;
  callSid: string | null;
  fromNumber: string;
  toNumber: string;
  direction: CallDirection;
  status: CallStatus;
  assistantId: string | null;
  duration: number | null;
  recordingUrl: string | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
}

/**
 * An SMS/WhatsApp message log entry
 */
export interface SmsLog {
  id: string;
  messageSid: string | null;
  fromNumber: string;
  toNumber: string;
  direction: SmsDirection;
  messageType: MessageType;
  body: string;
  status: SmsStatus;
  assistantId: string | null;
  createdAt: string;
}

/**
 * A routing rule that maps incoming calls/messages to assistants
 */
export interface RoutingRule {
  id: string;
  name: string;
  priority: number;
  fromPattern: string | null;
  toPattern: string | null;
  messageType: MessageType | 'voice' | 'all';
  timeOfDay: string | null;
  dayOfWeek: string | null;
  keyword: string | null;
  targetAssistantId: string;
  targetAssistantName: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

// ============================================
// Active Call Types (in-memory)
// ============================================

export type ActiveCallState = 'connecting' | 'ringing' | 'bridging' | 'active' | 'on-hold' | 'ending';

/**
 * In-memory representation of an active call
 */
export interface ActiveCall {
  callSid: string;
  streamSid: string | null;
  fromNumber: string;
  toNumber: string;
  direction: CallDirection;
  state: ActiveCallState;
  assistantId: string | null;
  bridgeId: string | null;
  startedAt: number;
  lastActivityAt: number;
}

// ============================================
// List/Summary Types
// ============================================

export interface CallListItem {
  id: string;
  fromNumber: string;
  toNumber: string;
  direction: CallDirection;
  status: CallStatus;
  duration: number | null;
  startedAt: string | null;
  createdAt: string;
  assistantId: string | null;
}

export interface SmsListItem {
  id: string;
  fromNumber: string;
  toNumber: string;
  direction: SmsDirection;
  messageType: MessageType;
  bodyPreview: string;
  status: SmsStatus;
  createdAt: string;
  assistantId: string | null;
}

// ============================================
// Input/Output Types
// ============================================

export interface TelephonyOperationResult {
  success: boolean;
  message: string;
  callSid?: string;
  messageSid?: string;
  id?: string;
}

export interface TelephonyStatus {
  enabled: boolean;
  twilioConfigured: boolean;
  elevenLabsConfigured: boolean;
  phoneNumbers: number;
  activeCalls: number;
  routingRules: number;
  recentCalls: number;
  recentMessages: number;
  defaultPhoneNumber: string | null;
  defaultPhoneNumberSource: 'config' | 'local' | 'env' | null;
}

// ============================================
// Twilio API Types
// ============================================

export interface TwilioCallParams {
  to: string;
  from: string;
  url?: string;
  twiml?: string;
  statusCallback?: string;
  record?: boolean;
  firstMessage?: string;
}

export interface StreamServerConfig {
  port?: number;
  host?: string;
}

export interface TwilioSmsParams {
  to: string;
  from: string;
  body: string;
  statusCallback?: string;
}

export interface TwilioMediaStreamMessage {
  event: 'connected' | 'start' | 'media' | 'stop' | 'mark';
  streamSid?: string;
  start?: {
    streamSid: string;
    accountSid: string;
    callSid: string;
    tracks: string[];
    mediaFormat: {
      encoding: string;
      sampleRate: number;
      channels: number;
    };
  };
  media?: {
    track: string;
    chunk: string;
    timestamp: string;
    payload: string;
  };
  stop?: {
    accountSid: string;
    callSid: string;
  };
  mark?: {
    name: string;
  };
}

// ============================================
// Config Sub-types
// ============================================

export interface TelephonyInjectionConfig {
  enabled?: boolean;
  maxPerTurn?: number;
}

export interface TelephonyStorageConfig {
  maxCallLogs?: number;
  maxSmsLogs?: number;
  maxAgeDays?: number;
}
