/**
 * LLM Execute Tool
 *
 * Execute a prompt using a specified LLM provider and model.
 * This tool is NOT registered in the default registry - it's used internally by DAGExecutor.
 */

import { z } from 'zod';
import { BaseTool, type ToolContext } from './base.js';
import { createLLMProvider } from '../providers/factory.js';
import type { Message, TextContentPart, ImageContentPart } from '../providers/types.js';

const attachmentSchema = z.object({
  filename: z.string().describe('Name of the file'),
  content: z.string().describe('Content of the file'),
  mimeType: z.string().optional().describe('MIME type of the file'),
});

const paramsSchema = z.object({
  reasoning_effort: z.enum(['low', 'medium', 'high']).optional().describe('Reasoning effort level'),
  max_tokens: z.number().int().positive().optional().describe('Maximum tokens in response'),
  temperature: z.number().min(0).max(2).optional().describe('Temperature for response randomness'),
}).optional();

const llmExecuteInputSchema = z.object({
  provider: z.enum(['openai', 'openrouter', 'ollama']).describe('LLM provider name'),
  model: z.string().describe('Model name to use'),
  task: z.string().describe('Task name or identifier'),
  prompt: z.string().describe('Prompt to send to the LLM'),
  attachments: z.array(attachmentSchema).optional().describe('Optional array of file attachments'),
  params: paramsSchema.describe('Optional parameters for LLM call'),
});

type LlmExecuteInput = z.infer<typeof llmExecuteInputSchema>;

interface LlmExecuteOutput {
  content: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  costUsd?: number;
  generationStats?: Record<string, any>;
  finishReason?: string;
  reasoning?: string;
}

export class LlmExecuteTool extends BaseTool<LlmExecuteInput, LlmExecuteOutput> {
  name = 'llmExecute';
  description = 'cd Execute a prompt using a specified LLM provider and model with optional attachments and parameters';
  inputSchema = llmExecuteInputSchema;

  private isImageFile(mimeType?: string, filename?: string): boolean {
    const imageMimeTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];
    
    if (mimeType && imageMimeTypes.includes(mimeType.toLowerCase())) {
      return true;
    }

    if (filename) {
      const ext = filename.toLowerCase().split('.').pop();
      return ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext || '');
    }

    return false;
  }

  async execute(input: LlmExecuteInput, ctx: ToolContext): Promise<LlmExecuteOutput> {
    ctx.logger.debug({
      provider: input.provider,
      model: input.model,
      hasAttachments: !!input.attachments?.length,
      attachmentCount: input.attachments?.length ?? 0,
      attachmentFiles: input.attachments?.map(a => a.filename) ?? [],
    }, '╰─Executing LLM call');

    try {
      const provider = createLLMProvider({
        provider: input.provider,
        model: input.model,
      });

      const validation = await provider.validateToolCallSupport(input.model);
      if (!validation.supported) {
        ctx.logger.warn(`╰─Model ${input.model} not supported: ${validation.message}`);
      }

      let userContent: string | (TextContentPart | ImageContentPart)[] = input.prompt;

      if (input.attachments && input.attachments.length > 0) {
        ctx.logger.debug({
          totalAttachments: input.attachments.length,
          filenames: input.attachments.map(a => ({ name: a.filename, mime: a.mimeType })),
        }, '╰─Processing attachments');

        const textFiles = input.attachments.filter(
          att => !this.isImageFile(att.mimeType, att.filename)
        );
        const imageFiles = input.attachments.filter(
          att => this.isImageFile(att.mimeType, att.filename)
        );

        ctx.logger.debug({
          textFileCount: textFiles.length,
          imageFileCount: imageFiles.length,
          textFiles: textFiles.map(a => a.filename),
          imageFiles: imageFiles.map(a => a.filename),
        }, '╰─Filtered files by type');

        let textPrompt = input.prompt;
        if (textFiles.length > 0) {
          const attachmentText = textFiles
            .map(att => `\n\n--- File: ${att.filename} ---\n${att.content}`)
            .join('');
          textPrompt = `${input.prompt}${attachmentText}`;
          ctx.logger.debug({
            appendedLength: attachmentText.length,
          }, '╰─Appended text files to prompt');
        }

        if (imageFiles.length > 0) {
          const contentParts: (TextContentPart | ImageContentPart)[] = [
            { type: 'text', text: textPrompt },
          ];

          for (const img of imageFiles) {
            const mimeType = img.mimeType || 'image/jpeg';
            const dataUrl = `data:${mimeType};base64,${img.content}`;
            contentParts.push({
              type: 'image_url',
              image_url: { url: dataUrl, detail: 'auto' },
            });
            ctx.logger.debug({
              filename: img.filename,
              mimeType,
            }, '╰─Added image attachment');
          }

          userContent = contentParts;
        } else {
          userContent = textPrompt;
        }
      }

      const messages: Message[] = [
        {
          role: 'system',
          content: `Task: ${input.task}`,
        },
        {
          role: 'user',
          content: userContent,
        },
      ];

      const temperature = input.params?.temperature ?? 0.7;
      const maxTokens = input.params?.max_tokens;

      const response = await provider.chat({
        messages,
        temperature,
        maxTokens,
      });

      ctx.logger.debug('LLM execution completed');
      ctx.emitEvent?.completed?.(`✨ completed`);
      
      return {
        content: response.content,
        usage: response.usage,
        costUsd: (response as any).costUsd,
        generationStats: (response as any).generationStats,
      };
    } catch (error) {
      ctx.logger.error({
        err: error,
        provider: input.provider,
        model: input.model,
        task: input.task,
      }, 'LLM execution failed');
      throw error;
    }
  }
}
