/**
 * Tools Service
 *
 * Lists available tools for agents.
 * Tools are registered at initialization and exposed through this service.
 */

import type { ToolDefinition } from '../../types/index.js';
import type { ToolRegistry } from '../tools/registry.js';

/**
 * ToolsService handles tool listing and queries
 */
export class ToolsService {
  private registry: ToolRegistry;

  constructor(registry: ToolRegistry) {
    this.registry = registry;
  }

  /**
   * List all available tools
   */
  async list(filter?: Record<string, any>): Promise<ToolDefinition[]> {
    let tools = this.registry.getAllDefinitions();

    if (filter?.name) {
      tools = tools.filter((t) => t.function.name === filter.name);
    }

    return tools;
  }

  /**
   * Get a specific tool by name
   */
  async get(name: string): Promise<ToolDefinition | null> {
    const tool = this.registry.get(name);
    return tool ? tool.toJSONSchema() : null;
  }
}
