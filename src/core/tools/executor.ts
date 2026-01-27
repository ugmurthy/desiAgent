/**
 * Tool Executor
 *
 * Executes tools during agent execution with validation and error handling.
 */

import { getLogger } from '../../util/logger.js';
import type { ToolResult } from '../../types/index.js';
import type { ToolRegistry } from './registry.js';
import type { ToolContext } from './base.js';
import { ToolError } from '../../errors/index.js';
import { resolve } from 'path';

/**
 * Tool executor for running tools during execution
 */
export class ToolExecutor {
  private registry: ToolRegistry;
  private logger = getLogger();
  private artifactsDir: string;

  constructor(registry: ToolRegistry, artifactsDir?: string) {
    this.registry = registry;
    this.artifactsDir = artifactsDir || process.env.ARTIFACTS_DIR || './artifacts';
  }

  /**
   * Execute a tool call
   */
  async execute(
    toolName: string,
    input: any,
    toolCallId?: string
  ): Promise<ToolResult> {
    const startTime = Date.now();

    // Validate tool exists
    if (!this.registry.hasTool(toolName)) {
      throw new ToolError(`Tool not found: ${toolName}`, toolName);
    }

    // Create tool context
    const ctx: ToolContext = {
      logger: {
        debug: (msg, data) => this.logger.debug(msg, data),
        info: (msg, data) => this.logger.info(msg, data),
        warn: (msg, data) => this.logger.warn(msg, data),
        error: (msg, data) => this.logger.error(msg, data),
      },
      onEvent: (event, data) => {
        this.logger.debug(`Tool event: ${event}`, data);
      },
      artifactsDir: resolve(this.artifactsDir),
    };

    try {
      this.logger.info(`Executing tool: ${toolName} (call ID: ${toolCallId})`);

      // Execute the tool
      const output = await this.registry.execute(toolName, input, ctx);

      const duration = Date.now() - startTime;

      this.logger.info(
        `Tool completed: ${toolName} (${duration}ms)`
      );

      return {
        toolName,
        toolCallId,
        status: 'success',
        output,
        timestamp: new Date(),
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.error(
        `Tool failed: ${toolName} (${duration}ms) - ${errorMessage}`
      );

      return {
        toolName,
        toolCallId,
        status: 'error',
        error: {
          message: errorMessage,
          code: error instanceof ToolError ? error.code : 'TOOL_ERROR',
        },
        timestamp: new Date(),
      };
    }
  }

  /**
   * Validate tool input against schema
   */
  validateToolInput(toolName: string, input: any): boolean {
    const tool = this.registry.get(toolName);

    if (!tool) {
      return false;
    }

    try {
      tool.inputSchema.parse(input);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get tool schema
   */
  getToolSchema(toolName: string) {
    const tool = this.registry.get(toolName);
    if (!tool) {
      return null;
    }
    return tool.toJSONSchema();
  }

  /**
   * List available tools
   */
  listTools() {
    return this.registry.getAllDefinitions();
  }
}
