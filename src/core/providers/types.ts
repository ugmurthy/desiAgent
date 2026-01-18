/**
 * LLM Provider Types
 *
 * Interfaces for different LLM providers (OpenAI, Ollama, etc.)
 */

import type { ToolDefinition } from '../../types/index.js';

/**
 * Message in a conversation
 */
export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Tool call from LLM response
 */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

/**
 * Usage information from LLM
 */
export interface UsageInfo {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * Finish reason for LLM response
 */
export type FinishReason = 'stop' | 'tool_calls' | 'length' | 'content_filter' | 'error';

/**
 * Chat call parameters
 */
export interface ChatParams {
  messages: Message[];
  temperature?: number;
  maxTokens?: number;
}

/**
 * Chat response
 */
export interface ChatResponse {
  content: string;
  usage?: UsageInfo;
  costUsd?: number;
  generationStats?: Record<string, any>;
}

/**
 * LLM call with tools parameters
 */
export interface LLMCallParams {
  messages: Message[];
  tools: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
}

/**
 * LLM response with tool calls
 */
export interface LLMResponse {
  thought: string;
  toolCalls?: ToolCall[];
  finishReason: FinishReason;
  usage?: UsageInfo;
  costUsd?: number;
  generationStats?: Record<string, any>;
}

/**
 * LLM Provider interface
 */
export interface LLMProvider {
  name: string;

  /**
   * Validate if model supports tool calling
   */
  validateToolCallSupport(model: string): Promise<{ supported: boolean; message?: string }>;

  /**
   * Simple chat call (no tools)
   */
  chat(params: ChatParams): Promise<ChatResponse>;

  /**
   * Call with tool support
   */
  callWithTools(params: LLMCallParams): Promise<LLMResponse>;
}

/**
 * Provider configuration
 */
export interface ProviderConfig {
  provider?: 'openai' | 'openrouter' | 'ollama';
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}
