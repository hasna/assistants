/**
 * TwilioClient - Twilio REST API wrapper using raw fetch (no SDK)
 *
 * Keeps the dependency footprint minimal (~0 KB vs ~14 MB for the Twilio SDK).
 * Uses Basic Auth with Account SID and Auth Token.
 */

import type { TwilioCallParams, TwilioSmsParams } from './types';

const TWILIO_API_BASE = 'https://api.twilio.com/2010-04-01';

export interface TwilioClientConfig {
  accountSid: string;
  authToken: string;
}

export interface TwilioApiResponse<T = Record<string, unknown>> {
  success: boolean;
  data?: T;
  error?: string;
  statusCode: number;
}

/**
 * TwilioClient wraps the Twilio REST API using fetch
 */
export class TwilioClient {
  private accountSid: string;
  private authToken: string;
  private authHeader: string;

  constructor(config: TwilioClientConfig) {
    this.accountSid = config.accountSid;
    this.authToken = config.authToken;
    this.authHeader = 'Basic ' + Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');
  }

  /**
   * Check if the client is properly configured
   */
  isConfigured(): boolean {
    return Boolean(this.accountSid && this.authToken);
  }

  // ============================================
  // Calls
  // ============================================

  /**
   * Initiate an outbound call
   */
  async makeCall(params: TwilioCallParams): Promise<TwilioApiResponse> {
    const body = new URLSearchParams();
    body.append('To', params.to);
    body.append('From', params.from);

    if (params.url) {
      // Append firstMessage as query param so the voice webhook can read it
      let url = params.url;
      if (params.firstMessage) {
        const sep = url.includes('?') ? '&' : '?';
        url += `${sep}firstMessage=${encodeURIComponent(params.firstMessage)}`;
      }
      body.append('Url', url);
    } else if (params.twiml) {
      body.append('Twiml', params.twiml);
    }

    if (params.statusCallback) {
      body.append('StatusCallback', params.statusCallback);
      body.append('StatusCallbackEvent', 'initiated ringing answered completed');
      body.append('StatusCallbackMethod', 'POST');
    }

    if (params.record) {
      body.append('Record', 'true');
    }

    return this.post(`/Accounts/${this.accountSid}/Calls.json`, body);
  }

  /**
   * Update a call (e.g., end it, redirect it)
   */
  async updateCall(callSid: string, updates: {
    status?: 'completed' | 'canceled';
    url?: string;
    twiml?: string;
  }): Promise<TwilioApiResponse> {
    const body = new URLSearchParams();

    if (updates.status) {
      body.append('Status', updates.status);
    }
    if (updates.url) {
      body.append('Url', updates.url);
    }
    if (updates.twiml) {
      body.append('Twiml', updates.twiml);
    }

    return this.post(`/Accounts/${this.accountSid}/Calls/${callSid}.json`, body);
  }

  /**
   * Get call details
   */
  async getCall(callSid: string): Promise<TwilioApiResponse> {
    return this.get(`/Accounts/${this.accountSid}/Calls/${callSid}.json`);
  }

  // ============================================
  // SMS / WhatsApp
  // ============================================

  /**
   * Send an SMS message
   */
  async sendSms(params: TwilioSmsParams): Promise<TwilioApiResponse> {
    const body = new URLSearchParams();
    body.append('To', params.to);
    body.append('From', params.from);
    body.append('Body', params.body);

    if (params.statusCallback) {
      body.append('StatusCallback', params.statusCallback);
    }

    return this.post(`/Accounts/${this.accountSid}/Messages.json`, body);
  }

  /**
   * Send a WhatsApp message (uses whatsapp: prefix)
   */
  async sendWhatsApp(params: TwilioSmsParams): Promise<TwilioApiResponse> {
    const to = params.to.startsWith('whatsapp:') ? params.to : `whatsapp:${params.to}`;
    const from = params.from.startsWith('whatsapp:') ? params.from : `whatsapp:${params.from}`;

    return this.sendSms({
      ...params,
      to,
      from,
    });
  }

  // ============================================
  // Phone Numbers
  // ============================================

  /**
   * List phone numbers on the account
   */
  async listPhoneNumbers(): Promise<TwilioApiResponse> {
    return this.get(`/Accounts/${this.accountSid}/IncomingPhoneNumbers.json`);
  }

  /**
   * Get details for a specific phone number
   */
  async getPhoneNumber(phoneSid: string): Promise<TwilioApiResponse> {
    return this.get(`/Accounts/${this.accountSid}/IncomingPhoneNumbers/${phoneSid}.json`);
  }

  /**
   * Update a phone number's webhook URLs
   */
  async updatePhoneNumber(phoneSid: string, updates: {
    voiceUrl?: string;
    voiceMethod?: string;
    smsUrl?: string;
    smsMethod?: string;
    statusCallback?: string;
  }): Promise<TwilioApiResponse> {
    const body = new URLSearchParams();

    if (updates.voiceUrl) {
      body.append('VoiceUrl', updates.voiceUrl);
      body.append('VoiceMethod', updates.voiceMethod || 'POST');
    }
    if (updates.smsUrl) {
      body.append('SmsUrl', updates.smsUrl);
      body.append('SmsMethod', updates.smsMethod || 'POST');
    }
    if (updates.statusCallback) {
      body.append('StatusCallback', updates.statusCallback);
    }

    return this.post(`/Accounts/${this.accountSid}/IncomingPhoneNumbers/${phoneSid}.json`, body);
  }

  // ============================================
  // Account
  // ============================================

  /**
   * Verify credentials by fetching account info
   */
  async verifyCredentials(): Promise<TwilioApiResponse> {
    return this.get(`/Accounts/${this.accountSid}.json`);
  }

  // ============================================
  // HTTP Helpers
  // ============================================

  private async get(path: string): Promise<TwilioApiResponse> {
    try {
      const response = await fetch(`${TWILIO_API_BASE}${path}`, {
        method: 'GET',
        headers: {
          'Authorization': this.authHeader,
          'Accept': 'application/json',
        },
      });

      const data = await response.json();

      if (!response.ok) {
        return {
          success: false,
          error: (data as Record<string, unknown>).message as string || `HTTP ${response.status}`,
          statusCode: response.status,
        };
      }

      return { success: true, data: data as Record<string, unknown>, statusCode: response.status };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        statusCode: 0,
      };
    }
  }

  private async post(path: string, body: URLSearchParams): Promise<TwilioApiResponse> {
    try {
      const response = await fetch(`${TWILIO_API_BASE}${path}`, {
        method: 'POST',
        headers: {
          'Authorization': this.authHeader,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        body: body.toString(),
      });

      const data = await response.json();

      if (!response.ok) {
        return {
          success: false,
          error: (data as Record<string, unknown>).message as string || `HTTP ${response.status}`,
          statusCode: response.status,
        };
      }

      return { success: true, data: data as Record<string, unknown>, statusCode: response.status };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        statusCode: 0,
      };
    }
  }
}

/**
 * Validate a Twilio webhook signature
 * @see https://www.twilio.com/docs/usage/security
 */
export function validateTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  signature: string
): boolean {
  try {
    // Sort params alphabetically and concatenate key+value pairs
    const sortedKeys = Object.keys(params).sort();
    let data = url;
    for (const key of sortedKeys) {
      data += key + params[key];
    }

    // HMAC-SHA1 and base64 encode
    const crypto = require('crypto');
    const hmac = crypto.createHmac('sha1', authToken);
    hmac.update(data);
    const expected = hmac.digest('base64');

    return expected === signature;
  } catch {
    return false;
  }
}
