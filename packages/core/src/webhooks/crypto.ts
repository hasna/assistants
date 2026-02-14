/**
 * Webhook Crypto Utilities
 * HMAC-SHA256 signature generation/verification, ID generation, and timestamp validation
 */

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { generateId } from '@hasna/assistants-shared';

// ============================================
// Secret Generation
// ============================================

/**
 * Generate a webhook secret with the whsec_ prefix
 * Returns a string like: whsec_a1b2c3d4e5f6...
 */
export function generateWebhookSecret(): string {
  const bytes = randomBytes(32);
  return `whsec_${bytes.toString('hex')}`;
}

// ============================================
// Signature Operations
// ============================================

/**
 * Sign a payload using HMAC-SHA256
 * @param payload - The raw payload string to sign
 * @param secret - The webhook secret (with or without whsec_ prefix)
 * @returns Hex-encoded HMAC-SHA256 signature
 */
export function signPayload(payload: string, secret: string): string {
  const key = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  return createHmac('sha256', key).update(payload).digest('hex');
}

/**
 * Verify a webhook signature using timing-safe comparison
 * @param payload - The raw payload string
 * @param signature - The signature to verify (hex-encoded)
 * @param secret - The webhook secret (with or without whsec_ prefix)
 * @returns true if signature is valid
 */
export function verifySignature(payload: string, signature: string, secret: string): boolean {
  try {
    const expected = signPayload(payload, secret);
    const sigBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expected, 'hex');

    if (sigBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return timingSafeEqual(sigBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

// ============================================
// Timestamp Validation
// ============================================

/**
 * Check if a timestamp is within an acceptable age window (replay protection)
 * @param timestamp - ISO 8601 timestamp string
 * @param maxAgeMs - Maximum age in milliseconds (default: 300000 = 5 minutes)
 * @returns true if timestamp is fresh enough
 */
export function isTimestampValid(timestamp: string, maxAgeMs: number = 300_000): boolean {
  try {
    const eventTime = new Date(timestamp).getTime();
    if (isNaN(eventTime)) return false;

    const now = Date.now();
    const age = Math.abs(now - eventTime);

    return age <= maxAgeMs;
  } catch {
    return false;
  }
}

// ============================================
// ID Generators
// ============================================

/**
 * Generate a unique webhook registration ID
 * Format: whk_xxxxxxxx
 */
export function generateWebhookId(): string {
  return `whk_${generateId().slice(0, 12)}`;
}

/**
 * Generate a unique webhook event ID
 * Format: evt_xxxxxxxx
 */
export function generateEventId(): string {
  return `evt_${generateId().slice(0, 12)}`;
}

/**
 * Generate a unique webhook delivery ID
 * Format: dlv_xxxxxxxx
 */
export function generateDeliveryId(): string {
  return `dlv_${generateId().slice(0, 12)}`;
}
