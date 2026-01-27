/**
 * Glob Tool
 *
 * Find files matching a glob pattern using Bun.Glob
 */

import { z } from 'zod';
import { resolve, relative } from 'path';
import { BaseTool, type ToolContext } from './base.js';

const globInputSchema = z.object({
  pattern: z.string().describe('Glob pattern (e.g., "**/*.ts", "src/**/*.py")'),
  ignore: z
    .array(z.string())
    .default(['node_modules/**', '.git/**'])
    .describe('Patterns to ignore'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .default(100)
    .describe('Maximum number of files to return'),
});

type GlobInput = z.infer<typeof globInputSchema>;

interface GlobOutput {
  pattern: string;
  files: string[];
  count: number;
  truncated: boolean;
}

export class GlobTool extends BaseTool<any, GlobOutput> {
  name = 'glob';
  description =
    'Find files matching a glob pattern in the artifacts directory. Returns file paths relative to artifacts directory.';
  inputSchema: any = globInputSchema;

  private getArtifactsDir(ctx: ToolContext): string {
    return resolve(ctx.artifactsDir || process.env.ARTIFACTS_DIR || './artifacts');
  }

  async execute(input: GlobInput, ctx: ToolContext): Promise<GlobOutput> {
    const ARTIFACTS_DIR = this.getArtifactsDir(ctx);
    const { pattern, ignore, limit } = input;

    if (pattern.includes('..')) {
      throw new Error('Invalid pattern: cannot contain ".."');
    }

    ctx.logger.info(`Searching for files matching: ${pattern}`);

    try {
      const glob = new Bun.Glob(pattern);
      const allFiles: string[] = [];

      for await (const file of glob.scan({
        cwd: ARTIFACTS_DIR,
        onlyFiles: true,
      })) {
        const absolutePath = resolve(ARTIFACTS_DIR, file);
        if (!absolutePath.startsWith(ARTIFACTS_DIR)) {
          throw new Error('Invalid match: path escapes artifacts directory');
        }

        // Check if file matches any ignore pattern
        let shouldIgnore = false;
        for (const ignorePattern of ignore) {
          const ignoreGlob = new Bun.Glob(ignorePattern);
          if (ignoreGlob.match(file)) {
            shouldIgnore = true;
            break;
          }
        }

        if (!shouldIgnore) {
          allFiles.push(relative(ARTIFACTS_DIR, absolutePath));
        }
      }

      const truncated = allFiles.length > limit;
      const files = allFiles.slice(0, limit);

      ctx.logger.info(`Found ${allFiles.length} files matching "${pattern}"${truncated ? ` (limited to ${limit})` : ''}`);
      ctx.emitEvent?.completed?.(`🔍 Found ${allFiles.length} files matching "${pattern}"${truncated ? ` (showing ${limit})` : ''}`);

      return {
        pattern,
        files,
        count: allFiles.length,
        truncated,
      };
    } catch (error) {
      ctx.logger.error({ err: error }, 'Glob search failed');
      throw error;
    }
  }
}
