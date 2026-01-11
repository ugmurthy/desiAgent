/**
 * Cron expression validation utilities
 */

import { CronExpressionParser } from 'cron-parser';

export interface CronValidationResult {
  valid: boolean;
  error?: string;
  nextRuns?: Date[];
}

/**
 * Validates a cron expression and optionally returns the next scheduled runs.
 * @param cronExpr - The cron expression to validate (e.g., "0 0 * * *")
 * @param numNextRuns - Number of next run times to calculate (default: 3)
 * @returns Validation result with optional next run times
 */
export function validateCronExpression(
  cronExpr: string,
  numNextRuns = 3
): CronValidationResult {
  try {
    const expression = CronExpressionParser.parse(cronExpr);
    const nextRuns: Date[] = [];

    for (let i = 0; i < numNextRuns; i++) {
      nextRuns.push(expression.next().toDate());
    }

    return {
      valid: true,
      nextRuns,
    };
  } catch (err) {
    const error = err as Error;
    return {
      valid: false,
      error: error.message,
    };
  }
}
