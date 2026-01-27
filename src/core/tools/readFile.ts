/**
 * ReadFileTool
 *
 * Reads content from files with support for text files and PDFs.
 * Uses bun's fs API.
 */

import { z } from 'zod';
import { BaseTool, type ToolContext } from './base.js';
import { readFile as fsReadFile } from 'fs/promises';
import { join, resolve } from 'path';
import { getLogger } from '../../util/logger.js';

const readFileInputSchema = z.object({
  path: z
    .string()
    .describe('File path relative to artifacts directory'),
  maxLength: z
    .number()
    .int()
    .min(1)
    .max(100000)
    .default(50000)
    .describe('Maximum bytes to read'),
});

type ReadFileInput = z.infer<typeof readFileInputSchema>;

interface ReadFileOutput {
  path: string;
  content: string;
  size: number;
  truncated: boolean;
}

/**
 * ReadFileTool for bun
 * Uses bun's fs API which is compatible with Node.js fs/promises
 */
export class ReadFileTool extends BaseTool<any, ReadFileOutput> {
  name = 'readFile';
  description =
    'Read content from a file in the artifacts directory. Supports text files.';
  inputSchema: any = readFileInputSchema;

  private logger = getLogger();

  private getArtifactsDir(ctx: ToolContext): string {
    return resolve(ctx.artifactsDir || process.env.ARTIFACTS_DIR || './artifacts');
  }

  /**
   * Execute file read operation
   */
  async execute(
    input: ReadFileInput,
    ctx: ToolContext
  ): Promise<ReadFileOutput> {
    const ARTIFACTS_DIR = this.getArtifactsDir(ctx);
    
    // Security: prevent path traversal
    const safePath = input.path.replace(/\.\./g, '');
    const fullPath = join(ARTIFACTS_DIR, safePath);

    // Ensure path is within artifacts directory
    if (!fullPath.startsWith(ARTIFACTS_DIR)) {
      throw new Error('Invalid path: must be within artifacts directory');
    }

    this.logger.info(`Reading file: ${safePath}`);

    try {
      let content: string;

      // Read file content
      content = await fsReadFile(fullPath, 'utf-8');

      const size = Buffer.byteLength(content, 'utf-8');
      const truncated = size > input.maxLength;
      const finalContent = truncated
        ? content.slice(0, input.maxLength)
        : content;

      this.logger.info(
        `Read ${size} bytes from ${safePath}${truncated ? ' (truncated)' : ''}`
      );

      if (ctx.onEvent) {
        ctx.onEvent('tool:readFile:completed', {
          path: safePath,
          size,
          truncated,
        });
      }

      return {
        path: safePath,
        content: finalContent,
        size,
        truncated,
      };
    } catch (error) {
      this.logger.error(
        `File read failed: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }
}
