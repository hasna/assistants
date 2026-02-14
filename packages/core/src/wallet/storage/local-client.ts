import { getDatabase } from '../../database';
import type { DatabaseConnection } from '../../database';
import type { Card, CardListItem } from '../types';

export interface LocalWalletClientOptions {
  db?: DatabaseConnection;
}

function getDb(injected?: DatabaseConnection): DatabaseConnection {
  if (injected) return injected;
  return getDatabase();
}

interface CardRow {
  id: string;
  assistant_id: string;
  name: string;
  card_number: string;
  expiry_month: string;
  expiry_year: string;
  cvv: string | null;
  card_type: string;
  billing_address: string | null;
  created_at: string;
}

export class LocalWalletClient {
  private injectedDb?: DatabaseConnection;

  constructor(options: LocalWalletClientOptions = {}) {
    this.injectedDb = options.db;
  }

  private db(): DatabaseConnection {
    return getDb(this.injectedDb);
  }

  async listCards(assistantId: string): Promise<CardListItem[]> {
    const rows = this.db().query<CardRow>(
      'SELECT * FROM wallet_cards WHERE assistant_id = ? ORDER BY created_at DESC'
    ).all(assistantId);

    return rows.map((row) => this.toCardListItem(row));
  }

  async getCard(assistantId: string, cardId: string): Promise<Card | null> {
    const row = this.db().query<CardRow>(
      'SELECT * FROM wallet_cards WHERE assistant_id = ? AND id = ?'
    ).get(assistantId, cardId);
    if (!row) return null;
    return this.rowToCard(row);
  }

  async createCard(assistantId: string, card: Card): Promise<void> {
    this.db().prepare(
      `INSERT OR REPLACE INTO wallet_cards (id, assistant_id, name, card_number, expiry_month, expiry_year, cvv, card_type, billing_address, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      card.id,
      assistantId,
      card.name,
      card.cardNumber,
      card.expiryMonth,
      card.expiryYear,
      card.cvv ?? null,
      card.cardType ?? 'visa',
      card.billingAddress ? JSON.stringify(card.billingAddress) : null,
      card.createdAt
    );
  }

  async deleteCard(assistantId: string, cardId: string): Promise<void> {
    this.db().prepare(
      'DELETE FROM wallet_cards WHERE assistant_id = ? AND id = ?'
    ).run(assistantId, cardId);
  }

  async checkCredentials(): Promise<{ valid: boolean; error?: string }> {
    return { valid: true };
  }

  private rowToCard(row: CardRow): Card {
    const card: Card = {
      id: row.id,
      name: row.name,
      cardholderName: '', // Not stored separately in DB schema; reconstructed from card data
      cardNumber: row.card_number,
      expiryMonth: row.expiry_month,
      expiryYear: row.expiry_year,
      cvv: row.cvv ?? '',
      cardType: row.card_type as Card['cardType'],
      createdAt: row.created_at,
      updatedAt: row.created_at,
    };
    if (row.billing_address) {
      card.billingAddress = JSON.parse(row.billing_address);
    }
    return card;
  }

  private toCardListItem(row: CardRow): CardListItem {
    return {
      id: row.id,
      name: row.name,
      last4: row.card_number.slice(-4),
      expiry: `${row.expiry_month}/${row.expiry_year.slice(-2)}`,
      cardType: row.card_type,
      createdAt: row.created_at,
    };
  }
}
