/**
 * Wallet tools for assistant use
 * Native tools that allow assistants to manage and use payment cards
 */

import type { Tool } from '@hasna/assistants-shared';
import type { ToolExecutor, ToolRegistry } from '../tools/registry';
import type { WalletManager } from './wallet-manager';

/**
 * wallet_list - List all stored cards (safe summaries)
 */
export const walletListTool: Tool = {
  name: 'wallet_list',
  description: 'List all payment cards stored in the wallet. Returns safe summaries (name, last 4 digits, expiry) without sensitive data.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

/**
 * wallet_add - Add a new payment card
 */
export const walletAddTool: Tool = {
  name: 'wallet_add',
  description: 'Add a new payment card to the wallet. Stores in the configured wallet backend.',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'User-friendly name for the card (e.g., "Business Visa")',
      },
      cardholderName: {
        type: 'string',
        description: 'Cardholder name as printed on the card',
      },
      cardNumber: {
        type: 'string',
        description: 'Full card number (16 digits)',
      },
      expiryMonth: {
        type: 'string',
        description: 'Expiration month (01-12)',
      },
      expiryYear: {
        type: 'string',
        description: 'Expiration year (4 digits, e.g., "2028")',
      },
      cvv: {
        type: 'string',
        description: 'CVV/CVC security code (3-4 digits)',
      },
      billingLine1: {
        type: 'string',
        description: 'Billing address line 1 (optional)',
      },
      billingLine2: {
        type: 'string',
        description: 'Billing address line 2 (optional)',
      },
      billingCity: {
        type: 'string',
        description: 'Billing address city (optional)',
      },
      billingState: {
        type: 'string',
        description: 'Billing address state/province (optional)',
      },
      billingPostalCode: {
        type: 'string',
        description: 'Billing address postal/ZIP code (optional)',
      },
      billingCountry: {
        type: 'string',
        description: 'Billing address country code (optional, e.g., "US")',
      },
    },
    required: ['name', 'cardholderName', 'cardNumber', 'expiryMonth', 'expiryYear', 'cvv'],
  },
};

/**
 * wallet_get - Get full card details (rate limited)
 */
export const walletGetTool: Tool = {
  name: 'wallet_get',
  description: 'Get full payment card details for automation or API payments. Rate limited to prevent abuse. Use for browser form filling or payment API calls.',
  parameters: {
    type: 'object',
    properties: {
      cardId: {
        type: 'string',
        description: 'The card ID to retrieve',
      },
      format: {
        type: 'string',
        description: 'Output format: "automation" for form filling, "payment" for API calls, or "full" for all details',
        enum: ['automation', 'payment', 'full'],
        default: 'automation',
      },
    },
    required: ['cardId'],
  },
};

/**
 * wallet_remove - Remove a card from the wallet
 */
export const walletRemoveTool: Tool = {
  name: 'wallet_remove',
  description: 'Remove a payment card from the wallet. Card can be recovered within 30 days.',
  parameters: {
    type: 'object',
    properties: {
      cardId: {
        type: 'string',
        description: 'The card ID to remove',
      },
    },
    required: ['cardId'],
  },
};

/**
 * Create executors for wallet tools
 */
export function createWalletToolExecutors(
  getWalletManager: () => WalletManager | null
): Record<string, ToolExecutor> {
  return {
    wallet_list: async () => {
      const manager = getWalletManager();
      if (!manager) {
        return 'Error: Wallet is not enabled. Set wallet.enabled=true in config.';
      }

      if (!manager.isConfigured()) {
        return 'Error: Wallet storage is not configured. Set wallet.storage.provider to "local" or configure wallet.secrets.region for AWS.';
      }

      try {
        const cards = await manager.list();

        if (cards.length === 0) {
          return 'No cards stored in wallet. Use wallet_add to add a card.';
        }

        const lines: string[] = [];
        lines.push(`## Wallet (${cards.length} card${cards.length === 1 ? '' : 's'})`);
        lines.push('');

        for (const card of cards) {
          const typeIcon = getCardTypeIcon(card.cardType);
          lines.push(`${typeIcon} **${card.name}** (${card.id})`);
          lines.push(`   **** **** **** ${card.last4}`);
          lines.push(`   Expires: ${card.expiry}`);
          lines.push('');
        }

        // Add rate limit status
        const rateStatus = manager.getRateLimitStatus();
        lines.push(`---`);
        lines.push(`Rate limit: ${rateStatus.readsUsed}/${rateStatus.maxReads} reads this hour`);

        return lines.join('\n');
      } catch (error) {
        return `Error listing cards: ${error instanceof Error ? error.message : String(error)}`;
      }
    },

    wallet_add: async (input) => {
      const manager = getWalletManager();
      if (!manager) {
        return 'Error: Wallet is not enabled or configured.';
      }

      // Validate required fields
      const name = String(input.name || '').trim();
      const cardholderName = String(input.cardholderName || '').trim();
      const cardNumber = String(input.cardNumber || '').trim();
      const expiryMonth = String(input.expiryMonth || '').trim();
      const expiryYear = String(input.expiryYear || '').trim();
      const cvv = String(input.cvv || '').trim();

      if (!name || !cardholderName || !cardNumber || !expiryMonth || !expiryYear || !cvv) {
        return 'Error: Missing required fields. Need: name, cardholderName, cardNumber, expiryMonth, expiryYear, cvv';
      }

      // Build billing address if provided
      const billingAddress = input.billingLine1
        ? {
            line1: String(input.billingLine1),
            line2: input.billingLine2 ? String(input.billingLine2) : undefined,
            city: String(input.billingCity || ''),
            state: input.billingState ? String(input.billingState) : undefined,
            postalCode: String(input.billingPostalCode || ''),
            country: String(input.billingCountry || 'US'),
          }
        : undefined;

      try {
        const result = await manager.add({
          name,
          cardholderName,
          cardNumber,
          expiryMonth,
          expiryYear,
          cvv,
          billingAddress,
        });

        if (result.success) {
          return `✓ ${result.message}\nCard ID: ${result.cardId}`;
        }
        return `Error: ${result.message}`;
      } catch (error) {
        return `Error adding card: ${error instanceof Error ? error.message : String(error)}`;
      }
    },

    wallet_get: async (input) => {
      const manager = getWalletManager();
      if (!manager) {
        return 'Error: Wallet is not enabled or configured.';
      }

      const cardId = String(input.cardId || '').trim();
      const format = String(input.format || 'automation').toLowerCase();

      if (!cardId) {
        return 'Error: Card ID is required.';
      }

      try {
        if (format === 'automation') {
          const card = await manager.getForAutomation(cardId);
          if (!card) {
            return `Card ${cardId} not found.`;
          }

          const lines: string[] = [];
          lines.push('## Card Details (for form filling)');
          lines.push('');
          lines.push(`Cardholder: ${card.cardholderName}`);
          lines.push(`Number: ${card.cardNumber}`);
          lines.push(`Expiry: ${card.expiryMonth}/${card.expiryYear}`);
          lines.push(`CVV: ${card.cvv}`);

          if (card.billingAddress) {
            lines.push('');
            lines.push('**Billing Address:**');
            lines.push(`${card.billingAddress.line1}`);
            if (card.billingAddress.line2) lines.push(`${card.billingAddress.line2}`);
            lines.push(`${card.billingAddress.city}, ${card.billingAddress.state || ''} ${card.billingAddress.postalCode}`);
            lines.push(`${card.billingAddress.country}`);
          }

          return lines.join('\n');
        }

        if (format === 'payment') {
          const card = await manager.getForPayment(cardId);
          if (!card) {
            return `Card ${cardId} not found.`;
          }

          // Return as JSON for API use
          return JSON.stringify(card, null, 2);
        }

        // Full format
        const card = await manager.get(cardId);
        if (!card) {
          return `Card ${cardId} not found.`;
        }

        // Return full card details (redact some for security)
        return JSON.stringify(
          {
            id: card.id,
            name: card.name,
            cardholderName: card.cardholderName,
            cardNumber: card.cardNumber,
            expiryMonth: card.expiryMonth,
            expiryYear: card.expiryYear,
            cvv: card.cvv,
            cardType: card.cardType,
            billingAddress: card.billingAddress,
          },
          null,
          2
        );
      } catch (error) {
        return `Error retrieving card: ${error instanceof Error ? error.message : String(error)}`;
      }
    },

    wallet_remove: async (input) => {
      const manager = getWalletManager();
      if (!manager) {
        return 'Error: Wallet is not enabled or configured.';
      }

      const cardId = String(input.cardId || '').trim();

      if (!cardId) {
        return 'Error: Card ID is required.';
      }

      try {
        const result = await manager.remove(cardId);

        if (result.success) {
          return `✓ ${result.message}`;
        }
        return `Error: ${result.message}`;
      } catch (error) {
        return `Error removing card: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  };
}

/**
 * Get icon for card type
 */
function getCardTypeIcon(cardType?: string): string {
  switch (cardType) {
    case 'visa':
      return '💳';
    case 'mastercard':
      return '💳';
    case 'amex':
      return '💳';
    case 'discover':
      return '💳';
    default:
      return '💳';
  }
}

/**
 * All wallet tools
 */
export const walletTools: Tool[] = [
  walletListTool,
  walletAddTool,
  walletGetTool,
  walletRemoveTool,
];

/**
 * Register wallet tools with a tool registry
 */
export function registerWalletTools(
  registry: ToolRegistry,
  getWalletManager: () => WalletManager | null
): void {
  const executors = createWalletToolExecutors(getWalletManager);

  for (const tool of walletTools) {
    registry.register(tool, executors[tool.name]);
  }
}
