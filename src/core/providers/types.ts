/**
 * LLM Provider Types
 *
 * Interfaces for different LLM providers (OpenAI, Ollama, etc.)
 */

import type { ToolDefinition } from '../../types/index.js';

/**
 * Image content part for multimodal messages
 */
export interface ImageContentPart {
  type: 'image_url';
  image_url: {
    url: string;
    detail?: 'auto' | 'low' | 'high';
  };
}

/**
 * Text content part for multimodal messages
 */
export interface TextContentPart {
  type: 'text';
  text: string;
}

/**
 * Content can be a string or array of content parts (for multimodal)
 */
export type MessageContent = string | (TextContentPart | ImageContentPart)[];

/**
 * Message in a conversation
 */
export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: MessageContent;
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
  abortSignal?: AbortSignal;
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
  abortSignal?: AbortSignal;
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
