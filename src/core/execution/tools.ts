/**
 * Tools Service
 *
 * Lists available tools for agents.
 * Tools are registered at initialization and exposed through this service.
 */

import type { ToolDefinition } from '../../types/index.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { BaseTool, ToolContext } from '../tools/base.js';

/**
 * ToolsService handles tool listing and queries
 */
export class ToolsService {
  private registry: ToolRegistry;
  private restrictedList: Set<string>;

  private static readonly DEFAULT_RESTRICTED: string[] = [
    'bash',
  //  'readFile',
  //  'writeFile',
    'fetchPage',
    'webSearch',
    'fetchURLs',
    'glob',
    'grep',
    'edit',
  //  'sendEmail',
  //  'readEmail',
    'sendWebhook',
  ];

  constructor(registry: ToolRegistry, restrictedList: string[] = ToolsService.DEFAULT_RESTRICTED) {
    this.registry = registry;
    this.restrictedList = new Set(restrictedList);
  }

  /**
   * List all available tools (with optional filtering)
   */
  async list(filter?: Record<string, any>): Promise<ToolDefinition[]> {
    let tools = this.registry.getAllDefinitions();

    if (filter?.name) {
      tools = tools.filter((t) => (t.function.name === filter.name && this.isRestricted(t.function.name)));
    } else {
      tools = tools.filter((t) =>  !this.isRestricted(t.function.name));
    }

   
    
    

    return tools;
  }

  /**
   * Get a specific tool by name (returns definition)
   */
  async get(name: string): Promise<ToolDefinition | null> {
    const tool = this.registry.get(name);
    
    return tool && this.isAllowed(name) ? tool.toJSONSchema()  : null;
  }

  /**
   * Get a tool instance by name
   */
  getTool(name: string): BaseTool | undefined {
     if (this.isAllowed(name)) {
      return this.registry.get(name);
     } else {
      return undefined;
     }
  }

  /**
   * Get all tool instances
   */
  // Not needed
  //getAll(): BaseTool[] {
  //  return this.registry.getAll();
  //}

  /**
   * Get all tool definitions
   */
  //Not needed
  // getAllDefinitions(): ToolDefinition[] {
  //   return this.registry.getAllDefinitions();
  // }

  /**
   * Check if a tool exists
   */
  // hasTool(name: string): boolean {
  //   return this.registry.hasTool(name);
  // }

  /**
   * Filter tools by names
   */
  // filterByNames(names?: string[]): BaseTool[] {
  //   return this.registry.filterByNames(names);
  // }

  /**
   * Register a new tool
   */
  // register(tool: BaseTool): void {
  //   this.registry.register(tool);
  // }

  /**
   * Check if a tool is restricted
   */
  isRestricted(name: string): boolean {
    return this.restrictedList.has(name);
  }

  isAllowed(name:string):boolean {
    return !this.isRestricted(name);
  }
  /**
   * Execute a tool by name (blocks restricted tools)
   */
  async execute(toolName: string, input: any, ctx: ToolContext): Promise<any> {
    if (this.isRestricted(toolName)) {
      return null
      //throw new Error(`Tool '${toolName}' is restricted and cannot be executed`);
    }
    return this.registry.execute(toolName, input, ctx);
  }
}
