/**
 * Edit Tool
 *
 * Edit an existing file by replacing specific text with new text
 */

import { z } from 'zod';
import { resolve } from 'path';
import { BaseTool, type ToolContext } from './base.js';

const editInputSchema = z.object({
  path: z.string().describe('File path relative to artifacts directory'),
  oldText: z.string().describe('The exact text to find and replace'),
  newText: z.string().describe('The text to replace with'),
  replaceAll: z.boolean().default(false).describe('Whether to replace all occurrences'),
});

type EditInput = z.infer<typeof editInputSchema>;

interface EditOutput {
  path: string;
  fullPath: string;
  replacements: number;
  success: boolean;
}

export class EditTool extends BaseTool<any, EditOutput> {
  name = 'edit';
  description = 'Edit an existing file by replacing specific text with new text';
  inputSchema: any = editInputSchema;

  private getArtifactsDir(ctx: ToolContext): string {
    return resolve(ctx.artifactsDir || process.env.ARTIFACTS_DIR || './artifacts');
  }

  async execute(input: EditInput, ctx: ToolContext): Promise<EditOutput> {
    const ARTIFACTS_DIR = this.getArtifactsDir(ctx);
    const fullPath = resolve(ARTIFACTS_DIR, input.path);

    if (!fullPath.startsWith(ARTIFACTS_DIR)) {
      throw new Error('Invalid path: must be within artifacts directory');
    }

    const safePath = fullPath.substring(ARTIFACTS_DIR.length + 1);

    ctx.logger.info(`Editing file: ${safePath}`);

    try {
      const file = Bun.file(fullPath);
      const exists = await file.exists();
      
      if (!exists) {
        throw new Error(`File not found: ${safePath}`);
      }

      const content = await file.text();

      if (!content.includes(input.oldText)) {
        throw new Error(`Text not found in file: "${input.oldText.slice(0, 50)}${input.oldText.length > 50 ? '...' : ''}"`);
      }

      let newContent: string;
      let replacements: number;

      if (input.replaceAll) {
        const parts = content.split(input.oldText);
        replacements = parts.length - 1;
        newContent = parts.join(input.newText);
      } else {
        replacements = 1;
        newContent = content.replace(input.oldText, input.newText);
      }

      await Bun.write(fullPath, newContent);

      ctx.logger.info(`Made ${replacements} replacement(s) in ${safePath}`);
      ctx.emitEvent?.completed?.(`✏️ Made ${replacements} replacement(s) in ${safePath}`);

      return {
        path: safePath,
        fullPath,
        replacements,
        success: true,
      };
    } catch (error) {
      ctx.logger.error({ err: error }, 'File edit failed');
      throw error;
    }
  }
}
