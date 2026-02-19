/**
 * Base Tool Class
 *
 * Abstract base class for all tools in desiAgent.
 * Tools are self-documenting, validated functions that agents can call.
 */

import type { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ToolDefinition } from '../../types/index.js';

/**
 * Tool execution context
 */
export interface ToolContext {
  logger: {
    debug: (msg: string | object, data?: any) => void;
    info: (msg: string | object, data?: any) => void;
    warn: (msg: string | object, data?: any) => void;
    error: (msg: string | object, data?: any) => void;
  };
  onEvent?: (event: string, data?: any) => void;
  db?: any;
  runId?: string;
  abortSignal?: AbortSignal;
  executionId?: string;
  subStepId?: string;
  artifactsDir: string;
  smtp?: {
    host: string | undefined;
    port: number;
    user: string | undefined;
    pass: string | undefined;
    from: string | undefined;
  };
  imap?: {
    host: string | undefined;
    port: number;
    user: string | undefined;
    pass: string | undefined;
  };
  emitEvent?: {
    started?: (message: string) => void;
    progress?: (message: string) => void;
    completed?: (message: string) => void;
  };
}

/**
 * Base class for all tool implementations
 */
export abstract class BaseTool<TInput = any, TOutput = any> {
  abstract name: string;
  abstract description: string;
  abstract inputSchema: z.ZodType<TInput>;

  /**
   * Execute the tool with validated input
   */
  abstract execute(input: TInput, ctx: ToolContext): Promise<TOutput>;

  /**
   * Convert tool to JSON schema for LLM consumption
   */
  toJSONSchema(): ToolDefinition {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const jsonSchema = zodToJsonSchema(this.inputSchema as any, {
      $refStrategy: 'none',
    });

    // Remove the root $schema property that zod-to-json-schema adds
    const { $schema, ...parameters } = jsonSchema as any;

    return {
      type: 'function',
      function: {
        name: this.name,
        description: this.description,
        parameters,
      },
    };
  }

  /**
   * Execute with timeout
   */
  protected async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    timeoutMessage = 'Operation timed out'
  ): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(
          () => reject(new Error(timeoutMessage)),
          timeoutMs
        )
      ),
    ]);
  }

  /**
   * Retry with exponential backoff
   */
  protected async retry<T>(
    fn: () => Promise<T>,
    maxAttempts = 3,
    delayMs = 1000
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError =
          error instanceof Error ? error : new Error(String(error));

        if (attempt < maxAttempts) {
          await new Promise((resolve) =>
            setTimeout(resolve, delayMs * attempt)
          );
        }
      }
    }

    throw lastError || new Error('All retry attempts failed');
  }
}
