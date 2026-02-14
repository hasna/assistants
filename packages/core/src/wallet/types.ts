/**
 * Wallet Types
 * Types for the assistant wallet system (payment card storage)
 */

/**
 * Full card data stored in AWS Secrets Manager
 */
export interface Card {
  /** Unique card ID */
  id: string;
  /** User-friendly name for the card (e.g., "Business Visa") */
  name: string;
  /** Cardholder name as printed on card */
  cardholderName: string;
  /** Full card number (16 digits typically) */
  cardNumber: string;
  /** Expiration month (01-12) */
  expiryMonth: string;
  /** Expiration year (4 digits, e.g., "2028") */
  expiryYear: string;
  /** CVV/CVC security code */
  cvv: string;
  /** Billing address (optional) */
  billingAddress?: BillingAddress;
  /** Card type if known */
  cardType?: 'visa' | 'mastercard' | 'amex' | 'discover' | 'other';
  /** When the card was added (ISO 8601) */
  createdAt: string;
  /** When the card was last updated (ISO 8601) */
  updatedAt: string;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Billing address for card
 */
export interface BillingAddress {
  /** Street address line 1 */
  line1: string;
  /** Street address line 2 (optional) */
  line2?: string;
  /** City */
  city: string;
  /** State/Province */
  state?: string;
  /** Postal/ZIP code */
  postalCode: string;
  /** Country code (ISO 3166-1 alpha-2) */
  country: string;
}

/**
 * Card list item - safe summary without sensitive data
 */
export interface CardListItem {
  /** Card ID */
  id: string;
  /** User-friendly name */
  name: string;
  /** Last 4 digits of card number */
  last4: string;
  /** Expiry in MM/YY format */
  expiry: string;
  /** Card type if known */
  cardType?: string;
  /** When the card was added */
  createdAt: string;
}

/**
 * Card data for browser form filling (automation)
 * Contains all fields needed to fill payment forms
 */
export interface CardForAutomation {
  /** Cardholder name */
  cardholderName: string;
  /** Full card number */
  cardNumber: string;
  /** Expiration month (01-12) */
  expiryMonth: string;
  /** Expiration year (2 or 4 digits based on form needs) */
  expiryYear: string;
  /** CVV/CVC */
  cvv: string;
  /** Billing address if available */
  billingAddress?: BillingAddress;
}

/**
 * Card data for payment API calls
 */
export interface CardForPayment {
  /** Full card number */
  number: string;
  /** Expiration month */
  expMonth: number;
  /** Expiration year */
  expYear: number;
  /** CVV */
  cvc: string;
  /** Cardholder name */
  name?: string;
  /** Billing address if available */
  address?: {
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  };
}

/**
 * Input for adding a new card
 */
export interface AddCardInput {
  /** User-friendly name for the card */
  name: string;
  /** Cardholder name as printed on card */
  cardholderName: string;
  /** Full card number */
  cardNumber: string;
  /** Expiration month (01-12) */
  expiryMonth: string;
  /** Expiration year (4 digits) */
  expiryYear: string;
  /** CVV/CVC security code */
  cvv: string;
  /** Billing address (optional) */
  billingAddress?: BillingAddress;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Rate limit tracking
 */
export interface RateLimitState {
  /** Card reads in the current hour window */
  reads: number;
  /** Start of current window (timestamp) */
  windowStart: number;
}

/**
 * Wallet operation result
 */
export interface WalletOperationResult {
  success: boolean;
  message: string;
  cardId?: string;
}
