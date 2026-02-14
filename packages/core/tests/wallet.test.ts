import { describe, expect, test, beforeEach, afterEach, mock } from 'bun:test';
import type { Card, CardListItem } from '../src/wallet/types';
import type { WalletConfig } from '@hasna/assistants-shared';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { closeDatabase, resetDatabaseSingleton } from '../src/database';

const storedCards = new Map<string, Card>();

const toCardListItem = (card: Card): CardListItem => ({
  id: card.id,
  name: card.name,
  last4: card.cardNumber.slice(-4),
  expiry: `${card.expiryMonth}/${card.expiryYear.slice(-2)}`,
  cardType: card.cardType,
  createdAt: card.createdAt,
});

mock.module('../src/wallet/storage/secrets-client', () => ({
  SecretsClient: class SecretsClient {
    async listCards(): Promise<CardListItem[]> {
      return Array.from(storedCards.values()).map(toCardListItem);
    }

    async getCard(_assistantId: string, cardId: string): Promise<Card | null> {
      return storedCards.get(cardId) || null;
    }

    async createCard(_assistantId: string, card: Card): Promise<void> {
      storedCards.set(card.id, card);
    }

    async deleteCard(_assistantId: string, cardId: string): Promise<void> {
      storedCards.delete(cardId);
    }

    async checkCredentials(): Promise<{ valid: boolean; error?: string }> {
      return { valid: true };
    }
  },
}));

const { WalletManager } = await import('../src/wallet/wallet-manager');
const { createWalletToolExecutors } = await import('../src/wallet/tools');

const configuredWallet = (overrides?: Partial<WalletConfig>): WalletConfig => ({
  enabled: true,
  secrets: {
    region: 'us-east-1',
  },
  ...overrides,
});

const futureYear = (): string => String(new Date().getFullYear() + 2);

const baseCardInput = () => ({
  name: 'Business Visa',
  cardholderName: 'Ada Lovelace',
  cardNumber: '4111 1111 1111 1111',
  expiryMonth: '1',
  expiryYear: futureYear(),
  cvv: '123',
});

describe('WalletManager', () => {
  let walletBaseDir: string;
  let originalAssistantsDir: string | undefined;

  beforeEach(() => {
    storedCards.clear();
    walletBaseDir = mkdtempSync(join(tmpdir(), 'wallet-test-'));
    originalAssistantsDir = process.env.ASSISTANTS_DIR;
    process.env.ASSISTANTS_DIR = walletBaseDir;
    resetDatabaseSingleton();
  });

  afterEach(() => {
    closeDatabase();
    resetDatabaseSingleton();
    process.env.ASSISTANTS_DIR = originalAssistantsDir;
    rmSync(walletBaseDir, { recursive: true, force: true });
  });

  test('isConfigured returns false when aws provider is selected without secrets config', () => {
    const manager = new WalletManager({
      assistantId: 'assistant-1',
      config: { enabled: true, storage: { provider: 'aws' } },
    });

    expect(manager.isConfigured()).toBe(false);
  });

  test('add returns error when backend is not configured', async () => {
    const manager = new WalletManager({
      assistantId: 'assistant-1',
      config: { enabled: true, storage: { provider: 'aws' } },
    });

    const result = await manager.add(baseCardInput());
    expect(result.success).toBe(false);
    expect(result.message).toContain('not configured');
  });

  test('uses local storage by default and persists under base dir', async () => {
    const manager = new WalletManager({
      assistantId: 'assistant-local',
      config: { enabled: true },
      baseDir: walletBaseDir,
    });

    expect(manager.isConfigured()).toBe(true);
    expect(manager.getStorageMode()).toBe('local');

    const addResult = await manager.add(baseCardInput());
    expect(addResult.success).toBe(true);
    expect(addResult.cardId).toBeTruthy();

    const listed = await manager.list();
    expect(listed).toHaveLength(1);
    expect(listed[0].last4).toBe('1111');

    const reloaded = new WalletManager({
      assistantId: 'assistant-local',
      config: { enabled: true },
      baseDir: walletBaseDir,
    });
    const listedAgain = await reloaded.list();
    expect(listedAgain).toHaveLength(1);
    expect(listedAgain[0].id).toBe(addResult.cardId);
  });

  test('validates card number', async () => {
    const manager = new WalletManager({
      assistantId: 'assistant-1',
      config: configuredWallet(),
    });

    const result = await manager.add({
      ...baseCardInput(),
      cardNumber: '1234',
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('Invalid card number');
  });

  test('adds a card and normalizes fields', async () => {
    const manager = new WalletManager({
      assistantId: 'assistant-1',
      config: configuredWallet(),
    });

    const result = await manager.add(baseCardInput());
    expect(result.success).toBe(true);
    expect(result.cardId).toBeTruthy();

    const card = await manager.get(result.cardId!);
    expect(card).not.toBeNull();
    expect(card?.cardNumber).toBe('4111111111111111');
    expect(card?.expiryMonth).toBe('01');
    expect(card?.cardType).toBe('visa');
  });

  test('getForPayment maps fields', async () => {
    const manager = new WalletManager({
      assistantId: 'assistant-1',
      config: configuredWallet(),
    });

    const result = await manager.add({
      ...baseCardInput(),
      billingAddress: {
        line1: '123 Main',
        city: 'Boston',
        postalCode: '02118',
        country: 'US',
      },
    });

    const payment = await manager.getForPayment(result.cardId!);
    expect(payment?.number).toBe('4111111111111111');
    expect(payment?.expMonth).toBe(1);
    expect(payment?.expYear).toBe(parseInt(futureYear(), 10));
    expect(payment?.address?.line1).toBe('123 Main');
  });

  test('rate limits card reads', async () => {
    const manager = new WalletManager({
      assistantId: 'assistant-1',
      config: configuredWallet({ security: { maxReadsPerHour: 1 } }),
    });

    const result = await manager.add(baseCardInput());
    await manager.get(result.cardId!);

    await expect(manager.get(result.cardId!)).rejects.toThrow('Rate limit exceeded');
  });

  test('remove returns not found when missing', async () => {
    const manager = new WalletManager({
      assistantId: 'assistant-1',
      config: configuredWallet(),
    });

    const result = await manager.remove('missing');
    expect(result.success).toBe(false);
    expect(result.message).toContain('not found');
  });
});

describe('Wallet tools', () => {
  beforeEach(() => {
    storedCards.clear();
  });

  test('wallet_list returns error without manager', async () => {
    const executors = createWalletToolExecutors(() => null);
    const result = await executors.wallet_list({});
    expect(result).toContain('not enabled');
  });

  test('wallet_add validates required fields', async () => {
    const manager = new WalletManager({
      assistantId: 'assistant-1',
      config: configuredWallet(),
    });
    const executors = createWalletToolExecutors(() => manager);
    const result = await executors.wallet_add({ name: 'Test' });
    expect(result).toContain('Missing required fields');
  });

  test('wallet_get returns payment payload', async () => {
    const manager = new WalletManager({
      assistantId: 'assistant-1',
      config: configuredWallet(),
    });
    const executors = createWalletToolExecutors(() => manager);

    const addResult = await manager.add(baseCardInput());
    const output = await executors.wallet_get({ cardId: addResult.cardId, format: 'payment' });

    const parsed = JSON.parse(output as string);
    expect(parsed.number).toBe('4111111111111111');
  });

  test('wallet_remove handles missing card id', async () => {
    const manager = new WalletManager({
      assistantId: 'assistant-1',
      config: configuredWallet(),
    });
    const executors = createWalletToolExecutors(() => manager);

    const output = await executors.wallet_remove({});
    expect(output).toContain('Card ID is required');
  });
});
