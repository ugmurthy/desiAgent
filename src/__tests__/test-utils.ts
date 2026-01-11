/**
 * Test Utilities
 *
 * Helper functions for setting up test environments
 */

import { getDatabase, closeDatabase } from '../db/client.js';
import type { DrizzleDB } from '../db/client.js';

/**
 * Create an in-memory test database
 */
export function createTestDatabase(): DrizzleDB {
  // Use a unique in-memory database for each test
  const dbPath = `:memory:`;
  return getDatabase(dbPath);
}

/**
 * Clean up test database
 */
export function cleanupTestDatabase(): void {
  closeDatabase();
}

/**
 * Create mock logger for tests
 */
export function createMockLogger() {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}
