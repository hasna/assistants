/**
 * TelephonyManager - Core orchestrator for telephony operations
 *
 * Combines TelephonyStore, TwilioClient, CallManager, and VoiceBridge
 * to provide a unified API for telephony features.
 * Follows the pattern from channels/manager.ts.
 */

import type { TelephonyConfig } from '@hasna/assistants-shared';
import { TelephonyStore } from './store';
import { TwilioClient } from './twilio-client';
import { CallManager } from './call-manager';
import { VoiceBridge } from './voice-bridge';
import { startStreamServer } from './stream-server';
import type {
  PhoneNumber,
  CallLog,
  SmsLog,
  RoutingRule,
  ActiveCall,
  CallListItem,
  SmsListItem,
  TelephonyOperationResult,
  TelephonyStatus,
  MessageType,
} from './types';

export interface TelephonyManagerOptions {
  assistantId: string;
  assistantName: string;
  config: TelephonyConfig;
}

/**
 * TelephonyManager handles all telephony operations for an assistant
 */
export class TelephonyManager {
  private assistantId: string;
  private assistantName: string;
  private config: TelephonyConfig;
  private store: TelephonyStore;
  private twilioClient: TwilioClient | null = null;
  private callManager: CallManager;
  private voiceBridge: VoiceBridge | null = null;
  private streamServer: { stop: () => void; port: number } | null = null;

  constructor(options: TelephonyManagerOptions) {
    this.assistantId = options.assistantId;
    this.assistantName = options.assistantName;
    this.config = options.config;
    this.store = new TelephonyStore();
    this.callManager = new CallManager({
      maxCallDurationSeconds: options.config.voice?.maxCallDurationSeconds,
    });

    // Initialize Twilio client if credentials are available
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (accountSid && authToken) {
      this.twilioClient = new TwilioClient({ accountSid, authToken });
    }

    // Initialize voice bridge if ElevenLabs is configured
    const elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;
    const elevenLabsAgentId = this.config.elevenLabsAgentId || process.env.ELEVENLABS_AGENT_ID;
    if (elevenLabsApiKey && elevenLabsAgentId) {
      this.voiceBridge = new VoiceBridge({
        elevenLabsApiKey,
        elevenLabsAgentId,
      });
    }
  }

  // ============================================
  // SMS
  // ============================================

  /**
   * Send an SMS message
   */
  async sendSms(to: string, body: string, from?: string): Promise<TelephonyOperationResult> {
    if (!this.twilioClient) {
      return {
        success: false,
        message: 'Twilio is not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.',
      };
    }

    const fromNumber = from || this.getDefaultPhoneNumber();
    if (!fromNumber) {
      return {
        success: false,
        message: 'No phone number configured. Set telephony.defaultPhoneNumber, TWILIO_PHONE_NUMBER, or /communication default <number>.',
      };
    }

    const webhookUrl = this.config.webhookUrl || process.env.TELEPHONY_WEBHOOK_URL;
    const statusCallback = webhookUrl ? `${webhookUrl}/api/v1/telephony/webhooks/sms-status` : undefined;

    const result = await this.twilioClient.sendSms({
      to,
      from: fromNumber,
      body,
      statusCallback,
    });

    if (!result.success) {
      return { success: false, message: `Failed to send SMS: ${result.error}` };
    }

    // Log the SMS
    const log = this.store.createSmsLog({
      messageSid: result.data?.sid as string,
      fromNumber,
      toNumber: to,
      direction: 'outbound',
      messageType: 'sms',
      body,
      status: 'queued',
      assistantId: this.assistantId,
    });

    return {
      success: true,
      message: `SMS sent to ${to}.`,
      messageSid: result.data?.sid as string,
      id: log.id,
    };
  }

  /**
   * Send a WhatsApp message
   */
  async sendWhatsApp(to: string, body: string, from?: string): Promise<TelephonyOperationResult> {
    if (!this.twilioClient) {
      return {
        success: false,
        message: 'Twilio is not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.',
      };
    }

    const fromNumber = from || this.getDefaultPhoneNumber();
    if (!fromNumber) {
      return {
        success: false,
        message: 'No phone number configured. Set telephony.defaultPhoneNumber, TWILIO_PHONE_NUMBER, or /communication default <number>.',
      };
    }

    const webhookUrl = this.config.webhookUrl || process.env.TELEPHONY_WEBHOOK_URL;
    const statusCallback = webhookUrl ? `${webhookUrl}/api/v1/telephony/webhooks/sms-status` : undefined;

    const result = await this.twilioClient.sendWhatsApp({
      to,
      from: fromNumber,
      body,
      statusCallback,
    });

    if (!result.success) {
      return { success: false, message: `Failed to send WhatsApp: ${result.error}` };
    }

    const log = this.store.createSmsLog({
      messageSid: result.data?.sid as string,
      fromNumber: `whatsapp:${fromNumber}`,
      toNumber: `whatsapp:${to}`,
      direction: 'outbound',
      messageType: 'whatsapp',
      body,
      status: 'queued',
      assistantId: this.assistantId,
    });

    return {
      success: true,
      message: `WhatsApp message sent to ${to}.`,
      messageSid: result.data?.sid as string,
      id: log.id,
    };
  }

  // ============================================
  // Calls
  // ============================================

  /**
   * Initiate an outbound voice call
   */
  async makeCall(to: string, from?: string, firstMessage?: string): Promise<TelephonyOperationResult> {
    if (!this.twilioClient) {
      return {
        success: false,
        message: 'Twilio is not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.',
      };
    }

    const fromNumber = from || this.getDefaultPhoneNumber();
    if (!fromNumber) {
      return {
        success: false,
        message: 'No phone number configured. Set telephony.defaultPhoneNumber, TWILIO_PHONE_NUMBER, or /communication default <number>.',
      };
    }

    const webhookUrl = this.config.webhookUrl || process.env.TELEPHONY_WEBHOOK_URL;
    if (!webhookUrl) {
      return {
        success: false,
        message: 'No webhook URL configured. Set telephony.webhookUrl or TELEPHONY_WEBHOOK_URL.',
      };
    }

    const result = await this.twilioClient.makeCall({
      to,
      from: fromNumber,
      url: `${webhookUrl}/api/v1/telephony/webhooks/voice`,
      statusCallback: `${webhookUrl}/api/v1/telephony/webhooks/voice-status`,
      record: this.config.voice?.recordCalls,
      firstMessage,
    });

    if (!result.success) {
      return { success: false, message: `Failed to make call: ${result.error}` };
    }

    const callSid = result.data?.sid as string;

    // Log the call
    const log = this.store.createCallLog({
      callSid,
      fromNumber,
      toNumber: to,
      direction: 'outbound',
      status: 'pending',
      assistantId: this.assistantId,
    });

    // Track as active call
    this.callManager.addCall({
      callSid,
      fromNumber,
      toNumber: to,
      direction: 'outbound',
      assistantId: this.assistantId,
    });

    return {
      success: true,
      message: `Calling ${to}...`,
      callSid,
      id: log.id,
    };
  }

  /**
   * Put a call on hold — replaces the media stream with hold music TwiML
   */
  async holdCall(callSid?: string): Promise<TelephonyOperationResult> {
    if (!this.twilioClient) {
      return { success: false, message: 'Twilio is not configured.' };
    }

    const call = callSid
      ? this.callManager.getCall(callSid)
      : this.getMostRecentActiveCall();
    if (!call) {
      return { success: false, message: callSid ? `Call ${callSid} not found.` : 'No active call.' };
    }
    if (call.state === 'on-hold') {
      return { success: false, message: 'Call is already on hold.' };
    }

    // Close the voice bridge so ElevenLabs disconnects
    if (call.bridgeId && this.voiceBridge) {
      this.voiceBridge.closeBridge(call.bridgeId);
    }

    // Update Twilio call with hold music TwiML
    const holdTwiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Please hold.</Say><Play loop="0">http://com.twilio.sounds.music.s3.amazonaws.com/MARKOVICHAMP-B8-V1.mp3</Play></Response>`;
    const result = await this.twilioClient.updateCall(call.callSid, { twiml: holdTwiml });
    if (!result.success) {
      return { success: false, message: `Failed to hold call: ${result.error}` };
    }

    this.callManager.updateState(call.callSid, 'on-hold');
    return { success: true, message: `Call ${call.callSid} is now on hold.`, callSid: call.callSid };
  }

  /**
   * Resume a held call — redirects back to voice webhook to reconnect stream
   */
  async resumeCall(callSid?: string): Promise<TelephonyOperationResult> {
    if (!this.twilioClient) {
      return { success: false, message: 'Twilio is not configured.' };
    }

    const call = callSid
      ? this.callManager.getCall(callSid)
      : this.getMostRecentHeldCall();
    if (!call) {
      return { success: false, message: callSid ? `Call ${callSid} not found.` : 'No held call.' };
    }
    if (call.state !== 'on-hold') {
      return { success: false, message: 'Call is not on hold.' };
    }

    const webhookUrl = this.config.webhookUrl || process.env.TELEPHONY_WEBHOOK_URL;
    if (!webhookUrl) {
      return { success: false, message: 'No webhook URL configured.' };
    }

    // Redirect call back to voice webhook — Twilio will reconnect with a new stream
    const result = await this.twilioClient.updateCall(call.callSid, {
      url: `${webhookUrl}/api/v1/telephony/webhooks/voice`,
    });
    if (!result.success) {
      return { success: false, message: `Failed to resume call: ${result.error}` };
    }

    this.callManager.updateState(call.callSid, 'active');
    return { success: true, message: `Call ${call.callSid} resumed.`, callSid: call.callSid };
  }

  /**
   * End a call — hangs up via Twilio API
   */
  async endCall(callSid?: string): Promise<TelephonyOperationResult> {
    if (!this.twilioClient) {
      return { success: false, message: 'Twilio is not configured.' };
    }

    const call = callSid
      ? this.callManager.getCall(callSid)
      : this.getMostRecentActiveCall() || this.getMostRecentHeldCall();
    if (!call) {
      return { success: false, message: callSid ? `Call ${callSid} not found.` : 'No active call.' };
    }

    // Close the voice bridge
    if (call.bridgeId && this.voiceBridge) {
      this.voiceBridge.closeBridge(call.bridgeId);
    }

    // End the call via Twilio
    const result = await this.twilioClient.updateCall(call.callSid, { status: 'completed' });
    if (!result.success) {
      return { success: false, message: `Failed to end call: ${result.error}` };
    }

    // Update in-memory state
    const endedCall = this.callManager.endCall(call.callSid);

    // Update persistent log
    if (endedCall) {
      const callLog = this.store.getCallLogBySid(call.callSid);
      if (callLog) {
        const duration = Math.floor((Date.now() - endedCall.startedAt) / 1000);
        this.store.updateCallLog(callLog.id, {
          status: 'completed',
          endedAt: new Date().toISOString(),
          duration,
        });
      }
    }

    return { success: true, message: `Call ${call.callSid} ended.`, callSid: call.callSid };
  }

  /**
   * Get all active calls with duration info
   */
  getActiveCalls(): (ActiveCall & { durationSeconds: number })[] {
    return this.callManager.getActiveCalls().map((call) => ({
      ...call,
      durationSeconds: Math.floor((Date.now() - call.startedAt) / 1000),
    }));
  }

  /**
   * Get the most recent active call (active or bridging state)
   */
  private getMostRecentActiveCall(): ActiveCall | null {
    const calls = this.callManager.getActiveCalls()
      .filter((c) => c.state === 'active' || c.state === 'bridging' || c.state === 'connecting' || c.state === 'ringing');
    if (calls.length === 0) return null;
    return calls.reduce((latest, c) => c.startedAt > latest.startedAt ? c : latest);
  }

  /**
   * Get the most recent held call
   */
  private getMostRecentHeldCall(): ActiveCall | null {
    const calls = this.callManager.getActiveCalls().filter((c) => c.state === 'on-hold');
    if (calls.length === 0) return null;
    return calls.reduce((latest, c) => c.startedAt > latest.startedAt ? c : latest);
  }

  // ============================================
  // Stream Server
  // ============================================

  /**
   * Start the WebSocket stream server for Twilio media streams
   */
  startStreamServer(port?: number): { port: number } {
    if (this.streamServer) {
      return { port: this.streamServer.port };
    }
    if (!this.voiceBridge) {
      throw new Error('Voice bridge is not configured. Set ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID.');
    }

    this.streamServer = startStreamServer({
      port: port || 8765,
      voiceBridge: this.voiceBridge,
      callManager: this.callManager,
      store: this.store,
    });

    return { port: this.streamServer.port };
  }

  /**
   * Stop the WebSocket stream server
   */
  stopStreamServer(): void {
    if (this.streamServer) {
      this.streamServer.stop();
      this.streamServer = null;
    }
  }

  // ============================================
  // History / Logs
  // ============================================

  /**
   * Get recent call history
   */
  getCallHistory(options?: { limit?: number; scope?: 'assistant' | 'all' }): CallListItem[] {
    const scope = options?.scope ?? 'assistant';
    return this.store.listCallLogs({
      assistantId: scope === 'assistant' ? this.assistantId : undefined,
      limit: options?.limit || 20,
    });
  }

  /**
   * Get recent SMS/WhatsApp history
   */
  getSmsHistory(options?: {
    limit?: number;
    messageType?: MessageType;
    scope?: 'assistant' | 'all';
  }): SmsListItem[] {
    const scope = options?.scope ?? 'assistant';
    return this.store.listSmsLogs({
      assistantId: scope === 'assistant' ? this.assistantId : undefined,
      messageType: options?.messageType,
      limit: options?.limit || 20,
    });
  }

  // ============================================
  // Phone Numbers
  // ============================================

  /**
   * List available phone numbers
   */
  listPhoneNumbers(): PhoneNumber[] {
    return this.store.listPhoneNumbers('active');
  }

  /**
   * Sync phone numbers from Twilio
   */
  async syncPhoneNumbers(): Promise<TelephonyOperationResult> {
    if (!this.twilioClient) {
      return { success: false, message: 'Twilio is not configured.' };
    }

    const result = await this.twilioClient.listPhoneNumbers();
    if (!result.success) {
      return { success: false, message: `Failed to list numbers: ${result.error}` };
    }

    const numbers = (result.data as Record<string, unknown>)?.incoming_phone_numbers as Array<Record<string, unknown>> || [];
    let synced = 0;

    for (const num of numbers) {
      const phoneNumber = String(num.phone_number || '');
      const existing = this.store.getPhoneNumberByNumber(phoneNumber);
      if (!existing && phoneNumber) {
        this.store.addPhoneNumber(
          phoneNumber,
          num.friendly_name ? String(num.friendly_name) : null,
          num.sid ? String(num.sid) : null,
          {
            voice: Boolean((num.capabilities as Record<string, boolean>)?.voice),
            sms: Boolean((num.capabilities as Record<string, boolean>)?.sms),
          }
        );
        synced++;
      }
    }

    return {
      success: true,
      message: `Synced ${synced} phone number${synced !== 1 ? 's' : ''} from Twilio.`,
    };
  }

  // ============================================
  // Routing Rules
  // ============================================

  /**
   * List routing rules
   */
  listRoutingRules(): RoutingRule[] {
    return this.store.listRoutingRules();
  }

  /**
   * Create a routing rule
   */
  createRoutingRule(params: {
    name: string;
    priority?: number;
    fromPattern?: string;
    toPattern?: string;
    messageType?: MessageType | 'voice' | 'all';
    keyword?: string;
    targetAssistantId: string;
    targetAssistantName: string;
  }): TelephonyOperationResult {
    const rule = this.store.createRoutingRule(params);
    return {
      success: true,
      message: `Routing rule "${rule.name}" created (priority ${rule.priority}).`,
      id: rule.id,
    };
  }

  /**
   * Delete a routing rule
   */
  deleteRoutingRule(id: string): TelephonyOperationResult {
    const success = this.store.deleteRoutingRule(id);
    return {
      success,
      message: success ? 'Routing rule deleted.' : 'Routing rule not found.',
    };
  }

  setDefaultPhoneNumber(number: string): TelephonyOperationResult {
    const trimmed = number.trim();
    if (!trimmed) {
      return { success: false, message: 'Default phone number is required.' };
    }
    this.store.setDefaultPhoneNumber(trimmed);
    return { success: true, message: `Default phone number set to ${trimmed}.` };
  }

  getDefaultPhoneNumber(): string | null {
    const configDefault = this.config.defaultPhoneNumber?.trim();
    if (configDefault) return configDefault;
    const stored = this.store.getDefaultPhoneNumber();
    if (stored) return stored;
    const envDefault = process.env.TWILIO_PHONE_NUMBER?.trim();
    return envDefault || null;
  }

  private getDefaultPhoneNumberSource(): 'config' | 'local' | 'env' | null {
    const configDefault = this.config.defaultPhoneNumber?.trim();
    if (configDefault) return 'config';
    const stored = this.store.getDefaultPhoneNumber();
    if (stored) return 'local';
    const envDefault = process.env.TWILIO_PHONE_NUMBER?.trim();
    if (envDefault) return 'env';
    return null;
  }

  // ============================================
  // Status
  // ============================================

  /**
   * Get telephony status summary
   */
  getStatus(): TelephonyStatus {
    const phoneNumbers = this.store.listPhoneNumbers('active');
    const recentCalls = this.store.listCallLogs({ limit: 100 });
    const recentMessages = this.store.listSmsLogs({ limit: 100 });
    const routingRules = this.store.listRoutingRules();
    const defaultPhoneNumber = this.getDefaultPhoneNumber();
    const defaultPhoneNumberSource = this.getDefaultPhoneNumberSource();

    return {
      enabled: this.config.enabled !== false,
      twilioConfigured: this.twilioClient?.isConfigured() ?? false,
      elevenLabsConfigured: this.voiceBridge?.isConfigured() ?? false,
      phoneNumbers: phoneNumbers.length,
      activeCalls: this.callManager.getActiveCallCount(),
      routingRules: routingRules.length,
      recentCalls: recentCalls.length,
      recentMessages: recentMessages.length,
      defaultPhoneNumber,
      defaultPhoneNumberSource,
    };
  }

  // ============================================
  // Context Injection
  // ============================================

  /**
   * Get unread inbound messages for context injection
   */
  getUnreadForInjection(): SmsLog[] {
    const injectionConfig = this.config.injection || {};
    if (injectionConfig.enabled === false) {
      return [];
    }

    const maxPerTurn = injectionConfig.maxPerTurn || 5;
    return this.store.getUnreadInboundSms(this.assistantId, maxPerTurn);
  }

  /**
   * Build context string for injection
   */
  buildInjectionContext(messages: SmsLog[]): string {
    if (messages.length === 0) return '';

    const lines: string[] = [];
    lines.push('## Incoming Telephony Messages');
    lines.push('');

    for (const msg of messages) {
      const type = msg.messageType === 'whatsapp' ? 'WhatsApp' : 'SMS';
      const ago = formatTimeAgo(msg.createdAt);
      lines.push(`**${type} from ${msg.fromNumber}** (${ago}):`);
      lines.push(msg.body);
      lines.push('');
    }

    lines.push('Use telephony_send_sms or telephony_send_whatsapp to reply.');
    return lines.join('\n');
  }

  /**
   * Mark injected messages as read (update status)
   */
  markInjected(messages: SmsLog[]): void {
    for (const msg of messages) {
      this.store.updateSmsStatus(msg.id, 'delivered');
    }
  }

  // ============================================
  // Accessors for Webhook Handlers
  // ============================================

  getStore(): TelephonyStore {
    return this.store;
  }

  getTwilioClient(): TwilioClient | null {
    return this.twilioClient;
  }

  getCallManager(): CallManager {
    return this.callManager;
  }

  getVoiceBridge(): VoiceBridge | null {
    return this.voiceBridge;
  }

  getAssistantId(): string {
    return this.assistantId;
  }

  getAssistantName(): string {
    return this.assistantName;
  }

  getConfig(): TelephonyConfig {
    return this.config;
  }

  // ============================================
  // Cleanup
  // ============================================

  cleanup(): number {
    const maxAgeDays = this.config.storage?.maxAgeDays || 90;
    const maxCallLogs = this.config.storage?.maxCallLogs || 1000;
    const maxSmsLogs = this.config.storage?.maxSmsLogs || 5000;

    // Clean up stale active calls
    this.callManager.cleanupStaleCalls();

    return this.store.cleanup(maxAgeDays, maxCallLogs, maxSmsLogs);
  }

  close(): void {
    // Stop stream server
    this.stopStreamServer();

    // End all active calls
    this.callManager.endAllCalls();

    // Close all voice bridges
    this.voiceBridge?.closeAll();

    // Close the database
    this.store.close();
  }
}

/**
 * Format a timestamp as relative time
 */
function formatTimeAgo(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;

  if (diffMs < 60_000) {
    const secs = Math.floor(diffMs / 1000);
    return `${secs}s ago`;
  }
  if (diffMs < 3_600_000) {
    const mins = Math.floor(diffMs / 60_000);
    return `${mins}m ago`;
  }
  if (diffMs < 86_400_000) {
    const hours = Math.floor(diffMs / 3_600_000);
    return `${hours}h ago`;
  }
  const days = Math.floor(diffMs / 86_400_000);
  return `${days}d ago`;
}

/**
 * Create a TelephonyManager from config
 */
export function createTelephonyManager(
  assistantId: string,
  assistantName: string,
  config: TelephonyConfig
): TelephonyManager {
  return new TelephonyManager({
    assistantId,
    assistantName,
    config,
  });
}
