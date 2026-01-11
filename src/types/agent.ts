import { z } from 'zod';

/**
 * Agent represents an autonomous agent with specific capabilities
 */
export interface Agent {
  id: string;
  name: string;
  version: string;
  description?: string;
  systemPrompt: string;
  provider: 'openai' | 'openrouter' | 'ollama';
  model: string;
  isActive: boolean;
  allowedTools?: string[];
  constraints?: AgentConstraints;
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, any>;
}

/**
 * Agent constraints and limits
 */
export interface AgentConstraints {
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  maxSteps?: number;
  timeout?: number; // milliseconds
}

/**
 * Tool definition (legacy format for listing)
 */
export interface Tool {
  name: string;
  description: string;
  parameters: ToolParameter[];
  output?: {
    type: string;
    description: string;
  };
  tags?: string[];
}

/**
 * Tool definition in OpenAI function format (for LLM consumption)
 */
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

/**
 * Tool parameter definition
 */
export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required: boolean;
  enum?: string[] | number[];
  default?: any;
}

/**
 * Tool execution request
 */
export interface ToolCall {
  name: string;
  input: Record<string, any>;
  id?: string;
}

/**
 * Tool execution result
 */
export interface ToolResult {
  toolName: string;
  toolCallId?: string;
  status: 'success' | 'error';
  output?: Record<string, any> | string;
  error?: {
    message: string;
    code?: string;
  };
  timestamp: Date;
}

/**
 * Agent definition loaded from .mdx file
 */
export interface AgentDefinition {
  name: string;
  version: string;
  description?: string;
  provider: string;
  model: string;
  tags?: string[];
  content: string; // Full markdown content
  frontmatter: Record<string, any>; // Parsed YAML frontmatter
}

/**
 * Zod schemas for validation
 */
export const AgentConstraintsSchema = z.object({
  maxTokens: z.number().optional(),
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  frequencyPenalty: z.number().min(-2).max(2).optional(),
  presencePenalty: z.number().min(-2).max(2).optional(),
  maxSteps: z.number().positive().optional(),
  timeout: z.number().positive().optional(),
});

export const ToolParameterSchema = z.object({
  name: z.string(),
  type: z.enum(['string', 'number', 'boolean', 'array', 'object']),
  description: z.string(),
  required: z.boolean(),
  enum: z.union([z.array(z.string()), z.array(z.number())]).optional(),
  default: z.any().optional(),
});

export const ToolSchema = z.object({
  name: z.string(),
  description: z.string(),
  parameters: z.array(ToolParameterSchema),
  output: z.object({
    type: z.string(),
    description: z.string(),
  }).optional(),
  tags: z.array(z.string()).optional(),
});

export const ToolCallSchema = z.object({
  name: z.string(),
  input: z.record(z.any()),
  id: z.string().optional(),
});

export const ToolResultSchema = z.object({
  toolName: z.string(),
  toolCallId: z.string().optional(),
  status: z.enum(['success', 'error']),
  output: z.union([z.record(z.any()), z.string()]).optional(),
  error: z.object({
    message: z.string(),
    code: z.string().optional(),
  }).optional(),
  timestamp: z.date(),
});

export const AgentSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  description: z.string().optional(),
  systemPrompt: z.string(),
  provider: z.enum(['openai', 'openrouter', 'ollama']),
  model: z.string(),
  isActive: z.boolean(),
  allowedTools: z.array(z.string()).optional(),
  constraints: AgentConstraintsSchema.optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
  metadata: z.record(z.any()).optional(),
});
