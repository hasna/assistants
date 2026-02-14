/**
 * Email providers for sending emails
 */

import type { InboxConfig } from '@hasna/assistants-shared';
import { SESProvider } from './ses';
import { ResendProvider } from './resend';

/**
 * Options for sending an email
 */
export interface SendEmailOptions {
  /** Sender email address */
  from: string;
  /** Recipient email address(es) */
  to: string | string[];
  /** Email subject */
  subject: string;
  /** Plain text body */
  text?: string;
  /** HTML body */
  html?: string;
  /** Reply-To address */
  replyTo?: string;
}

/**
 * Result from sending an email
 */
export interface SendEmailResult {
  /** Message ID from the provider */
  messageId: string;
}

/**
 * Email provider interface
 */
export interface EmailProvider {
  send(options: SendEmailOptions): Promise<SendEmailResult>;
}

/**
 * Create an email provider based on configuration
 */
export function createEmailProvider(config: InboxConfig): EmailProvider {
  const provider = config.provider || 'ses';

  if (provider === 'resend') {
    return new ResendProvider({
      apiKeyEnvVar: config.resend?.apiKeyEnvVar,
    });
  }

  // Default to SES
  // SES can use its own credentials profile (different AWS account) or fall back to storage profile
  const region = config.ses?.region || config.storage?.region || 'us-east-1';
  const credentialsProfile = config.ses?.credentialsProfile || config.storage?.credentialsProfile;
  return new SESProvider({
    region,
    credentialsProfile,
  });
}

export { SESProvider } from './ses';
export { ResendProvider } from './resend';
