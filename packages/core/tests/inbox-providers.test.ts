import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

let lastSesConfig: any = null;
let lastSesCommandInput: any = null;
let sesSendResponse: any = { MessageId: 'ses-1' };
let lastResendPayload: any = null;
let resendResponse: any = { data: { id: 'resend-1' } };
let lastFromIniInput: any = null;

mock.module('@aws-sdk/credential-providers', () => ({
  fromIni: (input: any) => {
    lastFromIniInput = input;
    return { profile: input.profile, mocked: true };
  },
}));

mock.module('@aws-sdk/client-ses', () => ({
  SESClient: class SESClient {
    constructor(config: any) {
      lastSesConfig = config;
    }

    async send(command: any): Promise<any> {
      lastSesCommandInput = command.input;
      return sesSendResponse;
    }
  },
  SendEmailCommand: class SendEmailCommand {
    input: any;

    constructor(input: any) {
      this.input = input;
    }
  },
}));

mock.module('resend', () => {
  class Resend {
    apiKey: string;
    emails: { send: (payload: any) => Promise<any> };

    constructor(apiKey: string) {
      this.apiKey = apiKey;
      this.emails = {
        send: async (payload: any) => {
          lastResendPayload = payload;
          return resendResponse;
        },
      };
    }
  }

  return { __esModule: true, Resend, default: Resend };
});

const { createEmailProvider } = await import('../src/inbox/providers');
const { ResendProvider } = await import('../src/inbox/providers/resend');
const { SESProvider } = await import('../src/inbox/providers/ses');

describe('Inbox providers', () => {
  beforeEach(() => {
    lastSesConfig = null;
    lastSesCommandInput = null;
    sesSendResponse = { MessageId: 'ses-1' };
    lastResendPayload = null;
    resendResponse = { data: { id: 'resend-1' } };
    lastFromIniInput = null;
    delete process.env.RESEND_API_KEY;
    delete process.env.CUSTOM_RESEND_KEY;
  });

  afterAll(() => {
    mock.restore();
  });

  test('ResendProvider throws when API key is missing', () => {
    expect(() => new ResendProvider()).toThrow('Resend API key not found');
  });

  test('ResendProvider sends email with html or text', async () => {
    process.env.CUSTOM_RESEND_KEY = 'token-123';
    const provider = new ResendProvider({ apiKeyEnvVar: 'CUSTOM_RESEND_KEY' });
    const result = await provider.send({
      from: 'from@example.com',
      to: 'to@example.com',
      subject: 'Hello',
      text: 'Plain',
    });

    expect(result.messageId).toBe('resend-1');
    expect(lastResendPayload).toEqual({
      from: 'from@example.com',
      to: ['to@example.com'],
      subject: 'Hello',
      replyTo: undefined,
      text: 'Plain',
    });

    resendResponse = { data: { id: 'resend-2' } };
    await provider.send({
      from: 'from@example.com',
      to: ['a@example.com', 'b@example.com'],
      subject: 'HTML',
      html: '<p>Hi</p>',
    });

    expect(lastResendPayload).toEqual({
      from: 'from@example.com',
      to: ['a@example.com', 'b@example.com'],
      subject: 'HTML',
      replyTo: undefined,
      html: '<p>Hi</p>',
    });
  });

  test('ResendProvider throws on API error', async () => {
    process.env.RESEND_API_KEY = 'token';
    const provider = new ResendProvider();
    resendResponse = { error: { message: 'boom' } };
    await expect(
      provider.send({ from: 'from@example.com', to: 'to@example.com', subject: 'Error', text: 'x' })
    ).rejects.toThrow('Resend error: boom');
  });

  test('SESProvider uses region and credentials profile', async () => {
    const provider = new SESProvider({ region: 'us-west-2', credentialsProfile: 'ses-prof' });
    await provider.send({
      from: 'from@example.com',
      to: 'to@example.com',
      subject: 'Hello',
      text: 'Plain',
      html: '<p>HTML</p>',
      replyTo: 'reply@example.com',
    });

    expect(lastSesConfig).toEqual({
      region: 'us-west-2',
      credentials: { profile: 'ses-prof', mocked: true },
    });
    expect(lastFromIniInput).toEqual({ profile: 'ses-prof' });
    expect(lastSesCommandInput).toEqual({
      Source: 'from@example.com',
      Destination: { ToAddresses: ['to@example.com'] },
      Message: {
        Subject: { Data: 'Hello', Charset: 'UTF-8' },
        Body: {
          Text: { Data: 'Plain', Charset: 'UTF-8' },
          Html: { Data: '<p>HTML</p>', Charset: 'UTF-8' },
        },
      },
      ReplyToAddresses: ['reply@example.com'],
    });
  });

  test('createEmailProvider selects correct provider', async () => {
    process.env.RESEND_API_KEY = 'token';
    const resendProvider = createEmailProvider({ provider: 'resend', resend: { apiKeyEnvVar: 'RESEND_API_KEY' } } as any);
    expect(resendProvider).toBeInstanceOf(ResendProvider);

    const sesProvider = createEmailProvider({
      provider: 'ses',
      ses: { region: 'us-east-2' },
      storage: { region: 'us-east-1', credentialsProfile: 'storage-prof' },
    } as any);
    expect(sesProvider).toBeInstanceOf(SESProvider);
    await sesProvider.send({ from: 'from@example.com', to: 'to@example.com', subject: 'Ses', text: 'x' });
    expect(lastSesConfig.region).toBe('us-east-2');
  });
});
