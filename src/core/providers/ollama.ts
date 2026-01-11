/**
 * Ollama LLM Provider
 *
 * Implements LLMProvider interface for Ollama (local LLM)
 */

import type {
  LLMProvider,
  ChatParams,
  ChatResponse,
  LLMCallParams,
  LLMResponse,
} from './types.js';
import { getLogger } from '../../util/logger.js';
import { LLMProviderError } from '../../errors/index.js';

/**
 * Ollama Provider
 */
export class OllamaProvider implements LLMProvider {
  name = 'ollama';
  private baseUrl: string;
  private model: string;
  private logger = getLogger();

  constructor(
    baseUrl: string = 'http://localhost:11434',
    model: string = 'mistral',
    _defaultMaxTokens: number = 4096
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.model = model;
    void _defaultMaxTokens; // Not used by Ollama API
  }

  /**
   * Validate if model supports tool calling
   */
  async validateToolCallSupport(
    model: string
  ): Promise<{ supported: boolean; message?: string }> {
    // Ollama has limited tool calling support
    // Most models don't support it natively
    return {
      supported: false,
      message: `Ollama model ${model} has limited tool calling support. Recommended: OpenAI or OpenRouter for reliable tool use.`,
    };
  }

  /**
   * Simple chat call (no tools)
   */
  async chat(params: ChatParams): Promise<ChatResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages: params.messages,
          stream: false,
          temperature: params.temperature ?? 0.7,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as any;

      this.logger.debug(
        `Ollama chat response (${this.model}): ${data.message?.content?.length || 0} chars`
      );

      return {
        content: data.message?.content || '',
      };
    } catch (error) {
      throw new LLMProviderError(
        `Ollama chat call failed: ${error instanceof Error ? error.message : String(error)}`,
        'ollama',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Call with tool support (limited/not supported)
   */
  async callWithTools(params: LLMCallParams): Promise<LLMResponse> {
    // Ollama doesn't have good tool calling support
    // Fall back to chat and try to parse tool calls from response
    this.logger.warn(
      'Ollama provider has limited tool calling support. Falling back to basic chat.'
    );

    const response = await this.chat({
      messages: params.messages,
      temperature: params.temperature,
      maxTokens: params.maxTokens,
    });

    // Try to parse tool calls from response (basic heuristic)
    const toolCalls = this.parseToolCallsFromText(response.content, params.tools);

    return {
      thought: response.content,
      toolCalls,
      finishReason: 'stop',
      usage: undefined,
    };
  }

  /**
   * Basic tool call parsing from text (heuristic)
   */
  private parseToolCallsFromText(content: string, tools: any[]) {
    // This is a very basic implementation
    // In production, you'd want more sophisticated parsing
    const toolCalls = [];

    for (const tool of tools) {
      const pattern = new RegExp(
        `\\b${tool.name}\\s*\\(([^)]*)\\)`,
        'gi'
      );
      const match = pattern.exec(content);

      if (match) {
        try {
          // Try to parse arguments as JSON or simple key=value pairs
          const argsStr = match[1];
          const args: Record<string, any> = {};

          if (argsStr.startsWith('{')) {
            Object.assign(args, JSON.parse(argsStr));
          } else {
            // Parse key=value pairs
            const pairs = argsStr.split(',');
            for (const pair of pairs) {
              const [key, value] = pair.split('=').map((s) => s.trim());
              if (key && value) {
                args[key] = value.replace(/^["']|["']$/g, '');
              }
            }
          }

          toolCalls.push({
            id: `${tool.name}_${Date.now()}`,
            name: tool.name,
            arguments: args,
          });
        } catch {
          // Skip if parsing fails
        }
      }
    }

    return toolCalls.length > 0 ? toolCalls : undefined;
  }
}
