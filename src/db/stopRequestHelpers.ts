/**
 * Stop Request Helpers
 *
 * Data-access helpers for creating, querying, and handling
 * stop requests stored in the dagStopRequests table.
 */

import { eq, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DrizzleDB } from './client.js';
import { dagStopRequests } from './schema.js';

/**
 * Insert a stop request for a given dagId.
 */
export async function insertStopRequestForDag(
  db: DrizzleDB,
  dagId: string
): Promise<void> {
  await db.insert(dagStopRequests).values({
    id: `stop_${nanoid(21)}`,
    dagId,
    executionId: null,
    status: 'requested',
    requestedAt: Date.now(),
    handledAt: null,
  });
}

/**
 * Insert a stop request for a given executionId.
 */
export async function insertStopRequestForExecution(
  db: DrizzleDB,
  executionId: string
): Promise<void> {
  await db.insert(dagStopRequests).values({
    id: `stop_${nanoid(21)}`,
    dagId: null,
    executionId,
    status: 'requested',
    requestedAt: Date.now(),
    handledAt: null,
  });
}

/**
 * Check if an active (status: 'requested') stop request exists for a dagId.
 */
export async function hasActiveStopRequestForDag(
  db: DrizzleDB,
  dagId: string
): Promise<boolean> {
  const rows = await db
    .select()
    .from(dagStopRequests)
    .where(
      and(
        eq(dagStopRequests.dagId, dagId),
        eq(dagStopRequests.status, 'requested')
      )
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Check if an active (status: 'requested') stop request exists for an executionId.
 */
export async function hasActiveStopRequestForExecution(
  db: DrizzleDB,
  executionId: string
): Promise<boolean> {
  const rows = await db
    .select()
    .from(dagStopRequests)
    .where(
      and(
        eq(dagStopRequests.executionId, executionId),
        eq(dagStopRequests.status, 'requested')
      )
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Mark a stop request as handled (sets status to 'handled' and handledAt to now).
 * Marks all active stop requests matching the given dagId.
 */
export async function markStopRequestHandledForDag(
  db: DrizzleDB,
  dagId: string
): Promise<void> {
  await db
    .update(dagStopRequests)
    .set({ status: 'handled', handledAt: Date.now() })
    .where(
      and(
        eq(dagStopRequests.dagId, dagId),
        eq(dagStopRequests.status, 'requested')
      )
    );
}

/**
 * Mark a stop request as handled for a given executionId.
 */
export async function markStopRequestHandledForExecution(
  db: DrizzleDB,
  executionId: string
): Promise<void> {
  await db
    .update(dagStopRequests)
    .set({ status: 'handled', handledAt: Date.now() })
    .where(
      and(
        eq(dagStopRequests.executionId, executionId),
        eq(dagStopRequests.status, 'requested')
      )
    );
}
