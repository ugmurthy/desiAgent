/**
 * Agents Service
 *
 * Manages agent creation, configuration, activation, and resolution.
 */

import { eq, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DrizzleDB } from '../../db/client.js';
import { agents } from '../../db/schema.js';
import type { Agent } from '../../types/index.js';
import { NotFoundError, ValidationError } from '../../errors/index.js';
import { getLogger } from '../../util/logger.js';

/**
 * Create an agent ID with 'agent_' prefix
 */
export function generateAgentId(): string {
  return `agent_${nanoid(21)}`;
}

/**
 * Agent cache entry with TTL
 */
interface CachedAgent {
  agent: Agent;
  timestamp: number;
}

/**
 * AgentsService handles all agent-related operations
 */
export class AgentsService {
  private db: DrizzleDB;
  private logger = getLogger();
  
  // LRU-style cache for resolved agents (by name)
  private static agentCache = new Map<string, CachedAgent>();
  private static readonly CACHE_TTL_MS = 60_000; // 1 minute TTL
  private static readonly MAX_CACHE_SIZE = 50;

  constructor(db: DrizzleDB) {
    this.db = db;
  }

  /**
   * Clear the agent cache (call after updates/activations)
   */
  static clearCache(agentName?: string): void {
    if (agentName) {
      AgentsService.agentCache.delete(agentName);
    } else {
      AgentsService.agentCache.clear();
    }
  }

  /**
   * Create a new agent
   */
  async create(
    name: string,
    version: string,
    systemPrompt: string,
    params?: Record<string, any>
  ): Promise<Agent> {
    this.logger.debug(`Creating agent: ${name}@${version}`);

    // Check for duplicate name+version
    const existing = await this.db.query.agents.findFirst({
      where: and(eq(agents.name, name), eq(agents.version, version)),
    });

    if (existing) {
      throw new ValidationError(
        `Agent with name "${name}" and version "${version}" already exists`,
        'name_version',
        { name, version }
      );
    }

    const agentId = generateAgentId();
    const now = new Date();

    await this.db.insert(agents).values({
      id: agentId,
      name,
      version,
      promptTemplate: systemPrompt,
      provider: params?.provider,
      model: params?.model,
      active: false,
      metadata: params?.metadata || {},
      createdAt: now,
      updatedAt: now,
    });

    const agent = await this.db.query.agents.findFirst({
      where: eq(agents.id, agentId),
    });

    if (!agent) {
      throw new Error('Failed to create agent');
    }

    return this.mapAgent(agent);
  }

  /**
   * Get an agent by ID
   */
  async get(id: string): Promise<Agent> {
    const agent = await this.db.query.agents.findFirst({
      where: eq(agents.id, id),
    });

    if (!agent) {
      throw new NotFoundError('Agent', id);
    }

    return this.mapAgent(agent);
  }

  /**
   * List all agents with optional filtering
   */
  async list(filter?: Record<string, any>): Promise<Agent[]> {
    const conditions = [];

    if (filter?.name) {
      conditions.push(eq(agents.name, filter.name));
    }

    if (filter?.active !== undefined) {
      conditions.push(eq(agents.active, filter.active));
    }

    const allAgents = await this.db.query.agents.findMany({
      where: conditions.length > 0 ? and(...conditions) : undefined,
      orderBy: (agents, { desc }) => [desc(agents.createdAt)],
    });

    return allAgents.map((a) => this.mapAgent(a));
  }

  /**
   * Update an agent
   */
  async update(id: string, updates: Partial<Agent>): Promise<Agent> {
    const existing = await this.db.query.agents.findFirst({
      where: eq(agents.id, id),
    });

    if (!existing) {
      throw new NotFoundError('Agent', id);
    }

    // Check for duplicate name+version if updating those fields
    if (
      (updates.name || updates.version) &&
      (updates.name !== existing.name || updates.version !== existing.version)
    ) {
      const duplicate = await this.db.query.agents.findFirst({
        where: and(
          eq(agents.name, updates.name || existing.name),
          eq(agents.version, updates.version || existing.version)
        ),
      });

      if (duplicate && duplicate.id !== id) {
        throw new ValidationError(
          `Agent with name and version already exists`,
          'name_version'
        );
      }
    }

    const updateData: Record<string, any> = {
      updatedAt: new Date(),
    };

    if (updates.name !== undefined) {
      updateData.name = updates.name;
    }
    if (updates.version !== undefined) {
      updateData.version = updates.version;
    }
    if (updates.systemPrompt !== undefined) {
      updateData.promptTemplate = updates.systemPrompt;
    }
    if (updates.constraints?.maxTokens !== undefined) {
      updateData.model = updates.constraints.maxTokens;
    }
    if (updates.metadata !== undefined) {
      updateData.metadata = updates.metadata;
    }

    await this.db.update(agents).set(updateData).where(eq(agents.id, id));

    // Invalidate cache for this agent
    AgentsService.clearCache(existing.name);
    if (updates.name && updates.name !== existing.name) {
      AgentsService.clearCache(updates.name);
    }

    const updated = await this.db.query.agents.findFirst({
      where: eq(agents.id, id),
    });

    if (!updated) {
      throw new Error('Failed to update agent');
    }

    return this.mapAgent(updated);
  }

  /**
   * Activate an agent (only one active per name)
   */
  async activate(id: string): Promise<Agent> {
    const agent = await this.db.query.agents.findFirst({
      where: eq(agents.id, id),
    });

    if (!agent) {
      throw new NotFoundError('Agent', id);
    }

    // Deactivate all other agents with the same name
    await this.db.update(agents)
      .set({ active: false, updatedAt: new Date() })
      .where(eq(agents.name, agent.name));

    // Activate this agent
    await this.db.update(agents)
      .set({ active: true, updatedAt: new Date() })
      .where(eq(agents.id, id));

    // Invalidate cache for this agent name
    AgentsService.clearCache(agent.name);

    const updated = await this.db.query.agents.findFirst({
      where: eq(agents.id, id),
    });

    if (!updated) {
      throw new Error('Failed to activate agent');
    }

    return this.mapAgent(updated);
  }

  /**
   * Resolve an agent by name (gets active agent with that name)
   * Uses caching for performance
   */
  async resolve(name: string): Promise<Agent | null> {
    // Check cache first
    const cached = AgentsService.agentCache.get(name);
    const now = Date.now();
    
    if (cached && (now - cached.timestamp) < AgentsService.CACHE_TTL_MS) {
      this.logger.debug(`Agent cache hit: ${name}`);
      return cached.agent;
    }

    // Cache miss or expired - fetch from DB
    const agent = await this.db.query.agents.findFirst({
      where: and(eq(agents.name, name), eq(agents.active, true)),
    });

    if (agent) {
      const mappedAgent = this.mapAgent(agent);
      
      // Evict oldest if cache is full
      if (AgentsService.agentCache.size >= AgentsService.MAX_CACHE_SIZE) {
        const firstKey = AgentsService.agentCache.keys().next().value;
        if (firstKey) AgentsService.agentCache.delete(firstKey);
      }
      
      AgentsService.agentCache.set(name, { agent: mappedAgent, timestamp: now });
      return mappedAgent;
    }

    return null;
  }

  /**
   * Delete an agent (cannot delete active agents)
   */
  async delete(id: string): Promise<void> {
    const agent = await this.db.query.agents.findFirst({
      where: eq(agents.id, id),
    });

    if (!agent) {
      throw new NotFoundError('Agent', id);
    }

    if (agent.active) {
      throw new ValidationError(
        'Cannot delete active agent. Activate another version first.',
        'active',
        agent.active
      );
    }

    await this.db.delete(agents).where(eq(agents.id, id));
    this.logger.debug(`Deleted agent: ${id}`);
  }

  /**
   * Map database record to Agent type
   */
  private mapAgent(record: any): Agent {
    return {
      id: record.id,
      name: record.name,
      version: record.version,
      description: record.metadata?.description,
      systemPrompt: record.promptTemplate,
      provider: (record.provider || 'openai') as 'openai' | 'openrouter' | 'ollama',
      model: record.model || 'gpt-4o',
      isActive: record.active,
      constraints: record.metadata?.constraints,
      metadata: record.metadata,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
