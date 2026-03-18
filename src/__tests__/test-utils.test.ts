/**
 * Tests for src/__tests__/test-utils.ts
 *
 * We mock db/client.js because the real implementation imports bun:sqlite
 * which is not available under vitest's Node ESM loader.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('../util/logger.js', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../db/client.js', () => ({
  getDatabase: vi.fn(() => ({ query: {} })),
  closeDatabase: vi.fn(),
}));

import { createTestDatabase, cleanupTestDatabase, createMockLogger } from './test-utils.js';

describe('test-utils', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createTestDatabase', () => {
    it('returns a database instance', () => {
      const db = createTestDatabase();
      expect(db).toBeDefined();
      expect(db).toHaveProperty('query');
    });

    it('calls getDatabase with :memory: path', async () => {
      createTestDatabase();
      const { getDatabase } = await import('../db/client.js');
      expect(getDatabase).toHaveBeenCalledWith(':memory:');
    });
  });

  describe('cleanupTestDatabase', () => {
    it('calls closeDatabase', async () => {
      cleanupTestDatabase();
      const { closeDatabase } = await import('../db/client.js');
      expect(closeDatabase).toHaveBeenCalled();
    });

    it('runs without error when called multiple times', () => {
      expect(() => {
        cleanupTestDatabase();
        cleanupTestDatabase();
      }).not.toThrow();
    });
  });

  describe('createMockLogger', () => {
    it('returns an object with all log methods', () => {
      const logger = createMockLogger();
      expect(logger.debug).toBeTypeOf('function');
      expect(logger.info).toBeTypeOf('function');
      expect(logger.warn).toBeTypeOf('function');
      expect(logger.error).toBeTypeOf('function');
    });

    it('log methods are callable without throwing', () => {
      const logger = createMockLogger();
      expect(() => logger.debug('test')).not.toThrow();
      expect(() => logger.info('test')).not.toThrow();
      expect(() => logger.warn('test')).not.toThrow();
      expect(() => logger.error('test')).not.toThrow();
    });

    it('log methods are no-ops (return undefined)', () => {
      const logger = createMockLogger();
      expect(logger.debug('msg')).toBeUndefined();
      expect(logger.info('msg')).toBeUndefined();
      expect(logger.warn('msg')).toBeUndefined();
      expect(logger.error('msg')).toBeUndefined();
    });
  });
});
