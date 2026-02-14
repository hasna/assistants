import { describe, expect, it } from 'bun:test';
import {
  generateWebhookSecret,
  signPayload,
  verifySignature,
  isTimestampValid,
  generateWebhookId,
  generateEventId,
  generateDeliveryId,
} from '../src/webhooks/crypto';

describe('Webhook Crypto', () => {
  describe('generateWebhookSecret', () => {
    it('should generate a secret with whsec_ prefix', () => {
      const secret = generateWebhookSecret();
      expect(secret).toStartWith('whsec_');
      expect(secret.length).toBeGreaterThan(10);
    });

    it('should generate unique secrets', () => {
      const secrets = new Set<string>();
      for (let i = 0; i < 10; i++) {
        secrets.add(generateWebhookSecret());
      }
      expect(secrets.size).toBe(10);
    });
  });

  describe('signPayload', () => {
    it('should generate a hex signature', () => {
      const sig = signPayload('test payload', 'whsec_abc123');
      expect(sig).toMatch(/^[0-9a-f]+$/);
      expect(sig.length).toBe(64); // SHA-256 = 32 bytes = 64 hex chars
    });

    it('should produce consistent signatures', () => {
      const secret = 'whsec_test_secret';
      const payload = '{"test": true}';
      const sig1 = signPayload(payload, secret);
      const sig2 = signPayload(payload, secret);
      expect(sig1).toBe(sig2);
    });

    it('should work with or without whsec_ prefix', () => {
      const payload = 'test';
      const sig1 = signPayload(payload, 'whsec_mysecret');
      const sig2 = signPayload(payload, 'mysecret');
      expect(sig1).toBe(sig2);
    });
  });

  describe('verifySignature', () => {
    it('should verify a valid signature', () => {
      const secret = generateWebhookSecret();
      const payload = JSON.stringify({ event: 'test', data: { foo: 'bar' } });
      const signature = signPayload(payload, secret);

      expect(verifySignature(payload, signature, secret)).toBe(true);
    });

    it('should reject an invalid signature', () => {
      const secret = generateWebhookSecret();
      const payload = '{"test": true}';
      const badSignature = 'a'.repeat(64);

      expect(verifySignature(payload, badSignature, secret)).toBe(false);
    });

    it('should reject a tampered payload', () => {
      const secret = generateWebhookSecret();
      const payload = '{"test": true}';
      const signature = signPayload(payload, secret);

      expect(verifySignature('{"test": false}', signature, secret)).toBe(false);
    });

    it('should reject a wrong secret', () => {
      const secret1 = generateWebhookSecret();
      const secret2 = generateWebhookSecret();
      const payload = 'test';
      const signature = signPayload(payload, secret1);

      expect(verifySignature(payload, signature, secret2)).toBe(false);
    });

    it('should handle malformed signatures gracefully', () => {
      expect(verifySignature('test', 'not-hex', 'whsec_test')).toBe(false);
      expect(verifySignature('test', '', 'whsec_test')).toBe(false);
    });
  });

  describe('isTimestampValid', () => {
    it('should accept a fresh timestamp', () => {
      const now = new Date().toISOString();
      expect(isTimestampValid(now)).toBe(true);
    });

    it('should accept a timestamp within the max age', () => {
      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
      expect(isTimestampValid(twoMinutesAgo, 300_000)).toBe(true);
    });

    it('should reject an old timestamp', () => {
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      expect(isTimestampValid(tenMinutesAgo, 300_000)).toBe(false);
    });

    it('should reject an invalid timestamp', () => {
      expect(isTimestampValid('not-a-date')).toBe(false);
      expect(isTimestampValid('')).toBe(false);
    });

    it('should use default max age of 5 minutes', () => {
      const fourMinutesAgo = new Date(Date.now() - 4 * 60 * 1000).toISOString();
      expect(isTimestampValid(fourMinutesAgo)).toBe(true);

      const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000).toISOString();
      expect(isTimestampValid(sixMinutesAgo)).toBe(false);
    });
  });

  describe('ID generators', () => {
    it('should generate webhook IDs with whk_ prefix', () => {
      const id = generateWebhookId();
      expect(id).toStartWith('whk_');
      expect(id.length).toBeGreaterThan(4);
    });

    it('should generate event IDs with evt_ prefix', () => {
      const id = generateEventId();
      expect(id).toStartWith('evt_');
      expect(id.length).toBeGreaterThan(4);
    });

    it('should generate delivery IDs with dlv_ prefix', () => {
      const id = generateDeliveryId();
      expect(id).toStartWith('dlv_');
      expect(id.length).toBeGreaterThan(4);
    });

    it('should generate unique IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 50; i++) {
        ids.add(generateWebhookId());
        ids.add(generateEventId());
        ids.add(generateDeliveryId());
      }
      expect(ids.size).toBe(150);
    });
  });
});
