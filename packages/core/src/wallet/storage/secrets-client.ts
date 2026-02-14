/**
 * AWS Secrets Manager client for wallet card storage
 * Handles encryption, storage, and retrieval of payment card data
 */

import {
  SecretsManagerClient,
  CreateSecretCommand,
  GetSecretValueCommand,
  UpdateSecretCommand,
  DeleteSecretCommand,
  ListSecretsCommand,
  ResourceNotFoundException,
} from '@aws-sdk/client-secrets-manager';
import { fromIni } from '@aws-sdk/credential-providers';
import type { Card, CardListItem } from '../types';

export interface SecretsClientOptions {
  /** AWS region */
  region: string;
  /** Secret path prefix (default: "assistants/wallet/") */
  prefix?: string;
  /** AWS credentials profile name (optional) */
  credentialsProfile?: string;
}

/**
 * AWS Secrets Manager client for secure card storage
 */
export class SecretsClient {
  private client: SecretsManagerClient;
  private prefix: string;

  constructor(options: SecretsClientOptions) {
    const credentials = options.credentialsProfile
      ? fromIni({ profile: options.credentialsProfile })
      : undefined;

    this.client = new SecretsManagerClient({
      region: options.region,
      credentials,
    });

    this.prefix = options.prefix || 'assistants/wallet/';
  }

  /**
   * Build the full secret name for a card
   */
  private buildSecretName(assistantId: string, cardId: string): string {
    return `${this.prefix}${assistantId}/${cardId}`;
  }

  /**
   * List all cards for an assistant
   * Returns safe card summaries (no sensitive data)
   */
  async listCards(assistantId: string): Promise<CardListItem[]> {
    const secretPrefix = `${this.prefix}${assistantId}/`;
    const cards: CardListItem[] = [];

    let nextToken: string | undefined;

    do {
      const response = await this.client.send(
        new ListSecretsCommand({
          NextToken: nextToken,
          Filters: [
            {
              Key: 'name',
              Values: [secretPrefix],
            },
          ],
        })
      );

      if (response.SecretList) {
        for (const secret of response.SecretList) {
          if (!secret.Name?.startsWith(secretPrefix)) continue;

          // Extract card ID from secret name
          const cardId = secret.Name.slice(secretPrefix.length);
          if (!cardId) continue;

          // Load the secret to get card details
          try {
            const card = await this.getCard(assistantId, cardId);
            if (card) {
              cards.push(this.toCardListItem(card));
            }
          } catch {
            // Skip cards that can't be loaded
          }
        }
      }

      nextToken = response.NextToken;
    } while (nextToken);

    return cards;
  }

  /**
   * Get full card data by ID
   */
  async getCard(assistantId: string, cardId: string): Promise<Card | null> {
    const secretName = this.buildSecretName(assistantId, cardId);

    try {
      const response = await this.client.send(
        new GetSecretValueCommand({
          SecretId: secretName,
        })
      );

      if (!response.SecretString) {
        return null;
      }

      return JSON.parse(response.SecretString) as Card;
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Store a new card
   */
  async createCard(assistantId: string, card: Card): Promise<void> {
    const secretName = this.buildSecretName(assistantId, card.id);

    try {
      await this.client.send(
        new CreateSecretCommand({
          Name: secretName,
          SecretString: JSON.stringify(card),
          Description: `Payment card: ${card.name} (**** ${card.cardNumber.slice(-4)})`,
          Tags: [
            { Key: 'type', Value: 'wallet-card' },
            { Key: 'assistantId', Value: assistantId },
          ],
        })
      );
    } catch (error: unknown) {
      // If secret already exists, update it
      if ((error as { name?: string }).name === 'ResourceExistsException') {
        await this.updateCard(assistantId, card);
        return;
      }
      throw error;
    }
  }

  /**
   * Update an existing card
   */
  async updateCard(assistantId: string, card: Card): Promise<void> {
    const secretName = this.buildSecretName(assistantId, card.id);

    await this.client.send(
      new UpdateSecretCommand({
        SecretId: secretName,
        SecretString: JSON.stringify(card),
        Description: `Payment card: ${card.name} (**** ${card.cardNumber.slice(-4)})`,
      })
    );
  }

  /**
   * Delete a card (soft delete with 30-day recovery window)
   */
  async deleteCard(assistantId: string, cardId: string): Promise<void> {
    const secretName = this.buildSecretName(assistantId, cardId);

    await this.client.send(
      new DeleteSecretCommand({
        SecretId: secretName,
        RecoveryWindowInDays: 30, // 30-day recovery window
      })
    );
  }

  /**
   * Convert full card to safe list item
   */
  private toCardListItem(card: Card): CardListItem {
    return {
      id: card.id,
      name: card.name,
      last4: card.cardNumber.slice(-4),
      expiry: `${card.expiryMonth}/${card.expiryYear.slice(-2)}`,
      cardType: card.cardType,
      createdAt: card.createdAt,
    };
  }

  /**
   * Check if AWS credentials are configured and valid
   */
  async checkCredentials(): Promise<{ valid: boolean; error?: string }> {
    try {
      // Try to list secrets with a minimal request
      await this.client.send(
        new ListSecretsCommand({
          MaxResults: 1,
          Filters: [
            {
              Key: 'name',
              Values: [this.prefix],
            },
          ],
        })
      );
      return { valid: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { valid: false, error: message };
    }
  }
}
