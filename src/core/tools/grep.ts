/**
 * Grep Tool
 *
 * Search file contents with regex patterns using Bun APIs
 */

import { z } from 'zod';
import { join, resolve } from 'path';
import { BaseTool, type ToolContext } from './base.js';

const grepInputSchema = z.object({
  pattern: z.string().describe('Regex pattern to search for'),
  path: z
    .string()
    .default('.')
    .describe('Directory or file path to search in (relative to artifacts, defaults to ".")'),
  glob: z
    .string()
    .optional()
    .describe('File glob pattern to filter files (e.g., "**/*.ts")'),
  caseSensitive: z.boolean().default(true).describe('Whether search is case sensitive'),
  maxResults: z.number().int().min(1).max(1000).default(50).describe('Maximum number of matches to return'),
});

type GrepInput = z.infer<typeof grepInputSchema>;

interface GrepMatch {
  file: string;
  line: number;
  content: string;
  match: string;
}

interface GrepOutput {
  pattern: string;
  matches: GrepMatch[];
  totalMatches: number;
  filesSearched: number;
  truncated: boolean;
}

export class GrepTool extends BaseTool<any, GrepOutput> {
  name = 'grep';
  description =
    'Search file contents with regex patterns in the artifacts directory. Returns matching lines with file paths and line numbers.';
  inputSchema: any = grepInputSchema;

  private getArtifactsDir(ctx: ToolContext): string {
    return resolve(ctx.artifactsDir);
  }

  private isBinaryFile(buffer: Buffer): boolean {
    const sampleSize = Math.min(buffer.length, 8000);
    for (let i = 0; i < sampleSize; i++) {
      if (buffer[i] === 0) {
        return true;
      }
    }
    return false;
  }

  private sanitizePath(inputPath: string): string {
    return inputPath.replace(/\.\./g, '');
  }

  private normalizePattern(pattern: string, caseSensitive: boolean): { pattern: string; caseSensitive: boolean } {
    let normalizedPattern = pattern;
    let normalizedCaseSensitive = caseSensitive;

    if (/\(\?i\)/.test(normalizedPattern)) {
      normalizedPattern = normalizedPattern.replace(/\(\?i\)/g, '');
      normalizedCaseSensitive = false;
    }

    if (/\(\?i:/.test(normalizedPattern)) {
      normalizedPattern = normalizedPattern.replace(/\(\?i:/g, '(?:');
      normalizedCaseSensitive = false;
    }

    return {
      pattern: normalizedPattern,
      caseSensitive: normalizedCaseSensitive,
    };
  }

  async execute(input: GrepInput, ctx: ToolContext): Promise<GrepOutput> {
    const ARTIFACTS_DIR = this.getArtifactsDir(ctx);
    const safePath = this.sanitizePath(input.path);
    const fullPath = join(ARTIFACTS_DIR, safePath);

    if (!fullPath.startsWith(ARTIFACTS_DIR)) {
      throw new Error('Invalid path: must be within artifacts directory');
    }

    ctx.logger.info(`Grep search: pattern="${input.pattern}" path="${safePath}"`);
    ctx.emitEvent?.started?.(`🔍 Searching for "${input.pattern}" in ${safePath}`);

    const normalized = this.normalizePattern(input.pattern, input.caseSensitive);
    const flags = normalized.caseSensitive ? 'g' : 'gi';
    let regex: RegExp;
    try {
      regex = new RegExp(normalized.pattern, flags);
    } catch (error) {
      throw new Error(`Invalid regex pattern: ${input.pattern}`);
    }

    const matches: GrepMatch[] = [];
    let totalMatches = 0;
    let filesSearched = 0;
    let truncated = false;

    const filesToSearch: string[] = [];

    try {
      const file = Bun.file(fullPath);
      const exists = await file.exists();
      
      if (exists) {
        const stat = await file.stat();
        if (stat && !stat.isDirectory()) {
          filesToSearch.push(fullPath);
        } else {
          // It's a directory, use glob
          const globPattern = input.glob || '**/*';
          const glob = new Bun.Glob(globPattern);
          
          for await (const match of glob.scan({
            cwd: fullPath,
            onlyFiles: true,
          })) {
            filesToSearch.push(join(fullPath, match));
          }
        }
      } else {
        throw new Error(`Path not found: ${safePath}`);
      }
    } catch (error) {
      if ((error as Error).message.includes('Path not found')) {
        throw error;
      }
      // Try as directory
      const globPattern = input.glob || '**/*';
      const glob = new Bun.Glob(globPattern);
      
      for await (const match of glob.scan({
        cwd: fullPath,
        onlyFiles: true,
      })) {
        filesToSearch.push(join(fullPath, match));
      }
    }

    for (const filePath of filesToSearch) {
      if (truncated) break;

      try {
        const file = Bun.file(filePath);
        const buffer = Buffer.from(await file.arrayBuffer());

        if (this.isBinaryFile(buffer)) {
          ctx.logger.debug(`Skipping binary file: ${filePath}`);
          continue;
        }

        filesSearched++;
        const content = buffer.toString('utf-8');
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          regex.lastIndex = 0;
          const matchResult = regex.exec(line);

          if (matchResult) {
            totalMatches++;

            if (matches.length < input.maxResults) {
              const relativePath = filePath.startsWith(ARTIFACTS_DIR)
                ? filePath.slice(ARTIFACTS_DIR.length + 1)
                : filePath;

              matches.push({
                file: relativePath,
                line: i + 1,
                content: line.slice(0, 200),
                match: matchResult[0],
              });
            } else {
              truncated = true;
            }
          }
        }
      } catch (error) {
        ctx.logger.debug(`Could not read file: ${filePath}`);
      }
    }

    ctx.logger.info(
      `Grep complete: ${totalMatches} matches in ${filesSearched} files${truncated ? ' (truncated)' : ''}`
    );
    ctx.emitEvent?.completed?.(
      `🔍 Found ${totalMatches} matches in ${filesSearched} files${truncated ? ' (results truncated)' : ''}`
    );

    return {
      pattern: input.pattern,
      matches,
      totalMatches,
      filesSearched,
      truncated,
    };
  }
}
