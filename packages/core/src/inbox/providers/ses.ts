/**
 * Amazon SES email provider
 */

import { SESClient, SendEmailCommand, type SendEmailCommandInput } from '@aws-sdk/client-ses';
import { fromIni } from '@aws-sdk/credential-providers';
import type { EmailProvider, SendEmailOptions, SendEmailResult } from './index';

export interface SESProviderOptions {
  /** AWS region for SES */
  region: string;
  /** AWS credentials profile for cross-account access */
  credentialsProfile?: string;
}

/**
 * Amazon SES email provider implementation
 */
export class SESProvider implements EmailProvider {
  private client: SESClient;

  constructor(options: SESProviderOptions) {
    const clientConfig: { region: string; credentials?: ReturnType<typeof fromIni> } = {
      region: options.region,
    };

    if (options.credentialsProfile) {
      clientConfig.credentials = fromIni({
        profile: options.credentialsProfile,
      });
    }

    this.client = new SESClient(clientConfig);
  }

  /**
   * Send an email via SES
   */
  async send(options: SendEmailOptions): Promise<SendEmailResult> {
    const toAddresses = Array.isArray(options.to) ? options.to : [options.to];

    const input: SendEmailCommandInput = {
      Source: options.from,
      Destination: {
        ToAddresses: toAddresses,
      },
      Message: {
        Subject: {
          Data: options.subject,
          Charset: 'UTF-8',
        },
        Body: {},
      },
    };

    // Add text body
    if (options.text) {
      input.Message!.Body!.Text = {
        Data: options.text,
        Charset: 'UTF-8',
      };
    }

    // Add HTML body
    if (options.html) {
      input.Message!.Body!.Html = {
        Data: options.html,
        Charset: 'UTF-8',
      };
    }

    // Add Reply-To if specified
    if (options.replyTo) {
      input.ReplyToAddresses = [options.replyTo];
    }

    const command = new SendEmailCommand(input);
    const response = await this.client.send(command);

    return {
      messageId: response.MessageId || 'unknown',
    };
  }
}
