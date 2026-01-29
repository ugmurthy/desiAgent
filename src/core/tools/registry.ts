/**
 * Tool Registry
 *
 * Manages tool registration and execution.
 */

import type { ToolDefinition } from '../../types/index.js';
import { BashTool } from './bash.js';
import { ReadFileTool } from './readFile.js';
import { WriteFileTool } from './writeFile.js';
import { FetchPageTool } from './fetchPage.js';
import { WebSearchTool } from './webSearch.js';
import { FetchURLsTool } from './fetchURLs.js';
import { GlobTool } from './glob.js';
import { GrepTool } from './grep.js';
import { EditTool } from './edit.js';
import { SendEmailTool } from './sendEmail.js';
import { ReadEmailTool } from './readEmail.js';
import { SendWebhookTool } from './sendWebhook.js';
import { getLogger } from '../../util/logger.js';
import type { ToolContext } from './base.js';
import type { BaseTool } from './base.js';

/**
 * Tool Registry - manages available tools
 */
export class ToolRegistry {
  private tools = new Map<string, BaseTool>();
  private logger = getLogger();

  constructor() {
    this.registerDefaultTools();
  }

  /**
   * Register default tools
   */
  private registerDefaultTools(): void {
    this.register(new BashTool());
    this.register(new ReadFileTool());
    this.register(new WriteFileTool());
    this.register(new FetchPageTool());
    this.register(new WebSearchTool());
    this.register(new FetchURLsTool());
    this.register(new GlobTool());
    this.register(new GrepTool());
    this.register(new EditTool());
    this.register(new SendEmailTool());
    this.register(new ReadEmailTool());
    this.register(new SendWebhookTool());
    this.logger.info('Registered 12 default tools');
  }

  /**
   * Register a tool
   */
  register(tool: BaseTool): void {
    this.tools.set(tool.name, tool);
    this.logger.debug(`Registered tool: ${tool.name}`);
  }

  /**
   * Get a tool by name
   */
  get(name: string): BaseTool | undefined {
    return this.tools.get(name);
  }

  /**
   * Get all tools
   */
  getAll(): BaseTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get all tool definitions
   */
  getAllDefinitions(): ToolDefinition[] {
    return this.getAll().map((tool) => tool.toJSONSchema());
  }

  /**
   * Check if tool exists
   */
  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Filter tools by names
   */
  filterByNames(names?: string[]): BaseTool[] {
    if (!names || names.length === 0) {
      return this.getAll();
    }
    return names
      .map((name) => this.get(name))
      .filter((tool): tool is BaseTool => tool !== undefined);
  }

  /**
   * Execute a tool
   */
  async execute(
    toolName: string,
    input: any,
    ctx: ToolContext
  ): Promise<any> {
    const tool = this.get(toolName);

    if (!tool) {
      throw new Error(`Tool not found: ${toolName}`);
    }

    this.logger.debug(
      `Executing tool: ${toolName}`
    );

    try {
      return await tool.execute(input, ctx);
    } catch (error) {
      this.logger.error(
        `Tool execution failed: ${toolName} - ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }
}

/**
 * Create a default tool registry
 */
export function createToolRegistry(): ToolRegistry {
  return new ToolRegistry();
}
