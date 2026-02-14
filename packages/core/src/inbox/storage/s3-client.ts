/**
 * S3 client for inbox email storage
 * Uses AWS SDK v3 for S3 operations
 */

import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  type ListObjectsV2CommandInput,
  type GetObjectCommandInput,
} from '@aws-sdk/client-s3';
import { fromIni } from '@aws-sdk/credential-providers';

export interface S3InboxClientOptions {
  /** S3 bucket name */
  bucket: string;
  /** AWS region */
  region: string;
  /** S3 prefix for inbox emails (default: "inbox/") */
  prefix?: string;
  /** AWS credentials profile for cross-account access */
  credentialsProfile?: string;
}

export interface S3ObjectInfo {
  /** S3 object key */
  key: string;
  /** Last modified timestamp */
  lastModified?: Date;
  /** Object size in bytes */
  size?: number;
}

/**
 * S3 client for reading inbox emails from S3
 */
export class S3InboxClient {
  private client: S3Client;
  private bucket: string;
  private prefix: string;

  constructor(options: S3InboxClientOptions) {
    this.bucket = options.bucket;
    this.prefix = options.prefix || 'inbox/';

    // Configure AWS SDK client
    const clientConfig: { region: string; credentials?: ReturnType<typeof fromIni> } = {
      region: options.region,
    };

    // Use named profile if specified
    if (options.credentialsProfile) {
      clientConfig.credentials = fromIni({
        profile: options.credentialsProfile,
      });
    }

    this.client = new S3Client(clientConfig);
  }

  /**
   * List objects in the inbox with optional filtering
   */
  async listObjects(params?: {
    /** Additional prefix to filter by (appended to base prefix) */
    prefix?: string;
    /** Maximum number of objects to return */
    maxKeys?: number;
    /** Continuation token for pagination */
    continuationToken?: string;
  }): Promise<{ objects: S3ObjectInfo[]; nextToken?: string }> {
    const fullPrefix = params?.prefix
      ? `${this.prefix}${params.prefix}`
      : this.prefix;

    const input: ListObjectsV2CommandInput = {
      Bucket: this.bucket,
      Prefix: fullPrefix,
      MaxKeys: params?.maxKeys || 100,
      ContinuationToken: params?.continuationToken,
    };

    const command = new ListObjectsV2Command(input);
    const response = await this.client.send(command);

    const objects: S3ObjectInfo[] = (response.Contents || []).map((obj) => ({
      key: obj.Key || '',
      lastModified: obj.LastModified,
      size: obj.Size,
    }));

    return {
      objects,
      nextToken: response.NextContinuationToken,
    };
  }

  /**
   * Get object content as Buffer
   */
  async getObject(key: string): Promise<Buffer> {
    const input: GetObjectCommandInput = {
      Bucket: this.bucket,
      Key: key,
    };

    const command = new GetObjectCommand(input);
    const response = await this.client.send(command);

    if (!response.Body) {
      throw new Error(`Empty response body for object: ${key}`);
    }

    // Convert stream to buffer
    const chunks: Uint8Array[] = [];
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  /**
   * Check if an object exists
   */
  async objectExists(key: string): Promise<boolean> {
    try {
      const input: GetObjectCommandInput = {
        Bucket: this.bucket,
        Key: key,
      };
      const command = new GetObjectCommand(input);
      await this.client.send(command);
      return true;
    } catch (error) {
      if ((error as { name?: string }).name === 'NoSuchKey') {
        return false;
      }
      throw error;
    }
  }

  /**
   * Get the full prefix path for an assistant
   */
  getAssistantPrefix(assistantId: string): string {
    return `${this.prefix}${assistantId}/`;
  }

  /**
   * Extract email ID from S3 key
   */
  extractEmailId(key: string): string {
    // Key format: inbox/{assistant-id}/{email-id}
    const parts = key.split('/');
    return parts[parts.length - 1] || key;
  }
}
