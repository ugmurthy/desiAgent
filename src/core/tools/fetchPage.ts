/**
 * FetchPageTool
 *
 * Fetches and extracts content from web pages.
 * Uses bun's built-in fetch API.
 */

import { z } from 'zod';
import { BaseTool, type ToolContext } from './base.js';
import { getLogger } from '../../util/logger.js';

const fetchPageInputSchema = z.object({
  url: z.string().url().describe('URL to fetch'),
  maxLength: z
    .number()
    .int()
    .default(50000)
    .describe('Maximum content length'),
  timeout: z
    .number()
    .default(30000)
    .describe('Request timeout in milliseconds'),
});

type FetchPageInput = z.infer<typeof fetchPageInputSchema>;

interface FetchPageOutput {
  url: string;
  status: number;
  contentType: string;
  content: string;
  contentLength: number;
  truncated: boolean;
}

/**
 * FetchPageTool for bun
 * Uses bun's native fetch API
 */
export class FetchPageTool extends BaseTool<any, FetchPageOutput> {
  name = 'fetchPage';
  description = 'Fetch and extract content from a web page';
  inputSchema: any = fetchPageInputSchema;

  private logger = getLogger();

  /**
   * Execute page fetch
   */
  async execute(
    input: FetchPageInput,
    ctx: ToolContext
  ): Promise<FetchPageOutput> {
    this.logger.info(`Fetching page: ${input.url}`);

    try {
      // Fetch with timeout using AbortController
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), input.timeout);

      try {
        const response = await fetch(input.url, {
          signal: controller.signal,
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(
            `HTTP ${response.status}: ${response.statusText}`
          );
        }

        const contentType =
          response.headers.get('content-type') || 'text/plain';
        let content = await response.text();

        const contentLength = Buffer.byteLength(content, 'utf-8');
        const truncated = contentLength > input.maxLength;

        if (truncated) {
          content = content.slice(0, input.maxLength);
        }

        this.logger.info(
          `Fetched ${contentLength} bytes from ${input.url} (status: ${response.status})`
        );

        if (ctx.onEvent) {
          ctx.onEvent('tool:fetchPage:completed', {
            url: input.url,
            status: response.status,
            contentLength,
            truncated,
          });
        }

        return {
          url: input.url,
          status: response.status,
          contentType,
          content,
          contentLength,
          truncated,
        };
      } catch (error) {
        clearTimeout(timeoutId);
        throw error;
      }
    } catch (error) {
      this.logger.error(
        `Fetch failed: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }
}
