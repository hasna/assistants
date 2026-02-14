/**
 * Resend email provider
 */

import { Resend } from 'resend';
import type { EmailProvider, SendEmailOptions, SendEmailResult } from './index';

export interface ResendProviderOptions {
  /** Environment variable name for API key (default: "RESEND_API_KEY") */
  apiKeyEnvVar?: string;
}

/**
 * Resend email provider implementation
 */
export class ResendProvider implements EmailProvider {
  private client: Resend;

  constructor(options: ResendProviderOptions = {}) {
    const envVar = options.apiKeyEnvVar || 'RESEND_API_KEY';
    const apiKey = process.env[envVar];

    if (!apiKey) {
      throw new Error(`Resend API key not found. Set the ${envVar} environment variable.`);
    }

    this.client = new Resend(apiKey);
  }

  /**
   * Send an email via Resend
   */
  async send(options: SendEmailOptions): Promise<SendEmailResult> {
    const toAddresses = Array.isArray(options.to) ? options.to : [options.to];

    // Resend requires at least one of: text, html
    // If neither provided, default to empty text
    const body: { text: string } | { html: string } = options.html
      ? { html: options.html }
      : { text: options.text || '' };

    const response = await this.client.emails.send({
      from: options.from,
      to: toAddresses,
      subject: options.subject,
      replyTo: options.replyTo,
      ...body,
    });

    if (response.error) {
      throw new Error(`Resend error: ${response.error.message}`);
    }

    return {
      messageId: response.data?.id || 'unknown',
    };
  }
}
