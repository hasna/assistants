import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

let lastS3Config: any = null;
let lastFromIniInput: any = null;
let sendImpl: ((command: any) => Promise<any>) | null = null;
let sentCommands: any[] = [];

mock.module('@aws-sdk/credential-providers', () => ({
  fromIni: (input: any) => {
    lastFromIniInput = input;
    return { profile: input.profile, mocked: true };
  },
}));

mock.module('@aws-sdk/client-s3', () => ({
  S3Client: class S3Client {
    constructor(config: any) {
      lastS3Config = config;
    }

    async send(command: any): Promise<any> {
      sentCommands.push(command);
      if (sendImpl) return await sendImpl(command);
      return {};
    }
  },
  ListObjectsV2Command: class ListObjectsV2Command {
    input: any;
    constructor(input: any) {
      this.input = input;
    }
  },
  GetObjectCommand: class GetObjectCommand {
    input: any;
    constructor(input: any) {
      this.input = input;
    }
  },
}));

const { S3InboxClient } = await import('../src/inbox/storage/s3-client');

describe('S3InboxClient', () => {
  beforeEach(() => {
    lastS3Config = null;
    lastFromIniInput = null;
    sendImpl = null;
    sentCommands = [];
  });

  afterAll(() => {
    mock.restore();
  });

  test('constructs with credentials profile and prefix helpers', () => {
    const client = new S3InboxClient({
      bucket: 'bucket',
      region: 'us-east-1',
      credentialsProfile: 'profile-1',
    });

    expect(lastFromIniInput).toEqual({ profile: 'profile-1' });
    expect(lastS3Config).toEqual({ region: 'us-east-1', credentials: { profile: 'profile-1', mocked: true } });
    expect(client.getAssistantPrefix('assistant-1')).toBe('inbox/assistant-1/');
    expect(client.extractEmailId('inbox/assistant-1/email-1')).toBe('email-1');
  });

  test('lists objects with optional filters', async () => {
    sendImpl = async (command) => {
      expect(command.input).toEqual({
        Bucket: 'bucket',
        Prefix: 'inbox/assistant-1/',
        MaxKeys: 5,
        ContinuationToken: 'next',
      });
      return {
        Contents: [
          { Key: 'inbox/assistant-1/email-1', LastModified: new Date('2020-01-01'), Size: 42 },
        ],
        NextContinuationToken: 'token-2',
      };
    };

    const client = new S3InboxClient({ bucket: 'bucket', region: 'us-east-1' });
    const result = await client.listObjects({ prefix: 'assistant-1/', maxKeys: 5, continuationToken: 'next' });

    expect(result.objects).toEqual([
      { key: 'inbox/assistant-1/email-1', lastModified: new Date('2020-01-01'), size: 42 },
    ]);
    expect(result.nextToken).toBe('token-2');
    expect(sentCommands.length).toBe(1);
  });

  test('getObject returns concatenated buffer', async () => {
    sendImpl = async () => ({
      Body: (async function* () {
        yield new Uint8Array([1, 2]);
        yield new Uint8Array([3]);
      })(),
    });

    const client = new S3InboxClient({ bucket: 'bucket', region: 'us-east-1' });
    const data = await client.getObject('key-1');
    expect(data).toEqual(Buffer.from([1, 2, 3]));
  });

  test('objectExists returns false on NoSuchKey', async () => {
    sendImpl = async () => {
      const error = new Error('missing');
      (error as any).name = 'NoSuchKey';
      throw error;
    };
    const client = new S3InboxClient({ bucket: 'bucket', region: 'us-east-1' });
    const exists = await client.objectExists('missing');
    expect(exists).toBe(false);
  });

  test('objectExists rethrows unexpected errors', async () => {
    sendImpl = async () => {
      const error = new Error('boom');
      (error as any).name = 'OtherError';
      throw error;
    };
    const client = new S3InboxClient({ bucket: 'bucket', region: 'us-east-1' });
    await expect(client.objectExists('missing')).rejects.toThrow('boom');
  });
});
