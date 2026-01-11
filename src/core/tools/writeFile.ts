/**
 * WriteFileTool
 *
 * Writes content to files with overwrite and append modes.
 * Uses bun's fs API.
 */

import { z } from 'zod';
import { BaseTool, type ToolContext } from './base.js';
import { writeFile, mkdir, readFile } from 'fs/promises';
import { dirname, resolve } from 'path';
import { existsSync } from 'fs';
import { getLogger } from '../../util/logger.js';

const writeFileInputSchema = z.object({
  path: z.string().describe('File path relative to artifacts directory'),
  content: z.string().describe('Content to write to the file'),
  mode: z
    .enum(['overwrite', 'append'])
    .default('overwrite')
    .describe('Write mode'),
});

type WriteFileInput = z.infer<typeof writeFileInputSchema>;

interface WriteFileOutput {
  path: string;
  fullPath: string;
  bytesWritten: number;
  mode: 'overwrite' | 'append';
}

/**
 * WriteFileTool for bun
 * Uses bun's fs API which is compatible with Node.js fs/promises
 */
export class WriteFileTool extends BaseTool<any, WriteFileOutput> {
  name = 'writeFile';
  description = 'Write content to a file in the artifacts directory';
  inputSchema: any = writeFileInputSchema;
  
  private artifactsDir = process.env.ARTIFACTS_DIR || './artifacts';
  private readonly ARTIFACTS_DIR =  resolve(this.artifactsDir);
  private logger = getLogger();

  /**
   * Strip outermost code fence from markdown
   */
  private stripOutermostFences(markdown: string): string {
    if (typeof markdown !== 'string') {
      return markdown;
    }

    const trimmed = markdown.trim();
    if (trimmed.length === 0) {
      return '';
    }

    // Regex to match a fence line: 3+ backticks or tildes
    const fenceRegex = /^([ \t]*)([`~]{3,})[^`\n~]*$/;

    const lines = trimmed.split('\n');

    // Check the first line for opening fence
    const firstLineMatch = lines[0].match(fenceRegex);
    if (!firstLineMatch) {
      return markdown;
    }

    const openingFenceChar = firstLineMatch[2][0];
    const openingFenceLength = firstLineMatch[2].length;

    // Find the closing fence
    let closingIndex = -1;
    for (let i = lines.length - 1; i > 0; i--) {
      const match = lines[i].match(fenceRegex);
      if (
        match &&
        match[2][0] === openingFenceChar &&
        match[2].length >= openingFenceLength
      ) {
        closingIndex = i;
        break;
      }
    }

    if (closingIndex === -1) {
      return markdown;
    }

    // Extract content between fences
    const contentLines = lines.slice(1, closingIndex);
    return contentLines.join('\n');
  }

  /**
   * Execute file write operation
   */
  async execute(
    input: WriteFileInput,
    ctx: ToolContext
  ): Promise<WriteFileOutput> {
    // Security: prevent path traversal
    const fullPath = resolve(this.ARTIFACTS_DIR, input.path);

    // Ensure path is within artifacts directory
    if (!fullPath.startsWith(this.ARTIFACTS_DIR)) {
      throw new Error('Invalid path: must be within artifacts directory');
    }

    const safePath = fullPath.substring(this.ARTIFACTS_DIR.length + 1);

    //this.logger.info(`Writing file: ${safePath}`);

    try {
      // Ensure directory exists
      const dir = dirname(fullPath);
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
      }

      // Write or append content
      let finalContent = this.stripOutermostFences(input.content);

      if (input.mode === 'append' && existsSync(fullPath)) {
        const existing = await readFile(fullPath, 'utf-8');
        finalContent = existing + finalContent;
      }

      await writeFile(fullPath, finalContent, 'utf-8');

      const bytesWritten = Buffer.byteLength(input.content, 'utf-8');

      //this.logger.info(`Wrote ${bytesWritten} bytes to ${safePath}`);

      if (ctx.onEvent) {
        ctx.onEvent('tool:writeFile:completed', {
          path: safePath,
          bytesWritten,
          mode: input.mode,
        });
      }

      return {
        path: safePath,
        fullPath,
        bytesWritten,
        mode: input.mode,
      };
    } catch (error) {
      this.logger.error(
        `File write failed: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }
}
