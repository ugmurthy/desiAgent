/**
 * Artifacts Service
 *
 * Manages artifact files generated during execution.
 * Artifacts are output files created by agents and stored for later retrieval.
 */

import { resolve, basename } from 'path';
import { existsSync } from 'fs';
import { readFile, readdir } from 'fs/promises';
import { getLogger } from '../../util/logger.js';
import { NotFoundError } from '../../errors/index.js';

/**
 * ArtifactsService handles artifact listing and retrieval
 */
export class ArtifactsService {
  private artifactsDir: string;
  private logger = getLogger();

  constructor(artifactsDir?: string) {
    this.artifactsDir = artifactsDir || resolve('./artifacts');
  }

  /**
   * List all artifacts
   */
  async list(): Promise<string[]> {
    try {
      if (!existsSync(this.artifactsDir)) {
        return [];
      }

      const files = await readdir(this.artifactsDir, { withFileTypes: true });
      const filenames = files
        .filter((file) => file.isFile())
        .map((file) => file.name)
        .sort();

      return filenames;
    } catch (error) {
      this.logger.error('Failed to list artifacts');
      return [];
    }
  }

  /**
   * Get an artifact by filename
   */
  async get(filename: string): Promise<Buffer> {
    // Security: prevent path traversal
    const safeFilename = basename(filename);
    const fullPath = resolve(this.artifactsDir, safeFilename);

    // Ensure the resolved path is within artifacts directory
    if (!fullPath.startsWith(this.artifactsDir)) {
      throw new NotFoundError('Artifact', filename);
    }

    if (!existsSync(fullPath)) {
      throw new NotFoundError('Artifact', filename);
    }

    try {
      const content = await readFile(fullPath);
      return content;
    } catch (error) {
      this.logger.error(`Failed to read artifact: ${filename}`);
      throw new NotFoundError('Artifact', filename);
    }
  }

  /**
   * Internal: Save an artifact
   */
  async _save(filename: string, content: Buffer | string): Promise<void> {
    try {
      // Ensure artifacts directory exists
      if (!existsSync(this.artifactsDir)) {
        // In Phase 2, we don't use mkdir to avoid dependencies
        // This will be handled in Phase 3+
        this.logger.warn(
          `Artifacts directory does not exist: ${this.artifactsDir}`
        );
        return;
      }

      const safeFilename = basename(filename);
      const fullPath = resolve(this.artifactsDir, safeFilename);

      // Prevent path traversal
      if (!fullPath.startsWith(this.artifactsDir)) {
        throw new Error('Invalid artifact path');
      }

      // TODO: Implement file writing in Phase 3
      // For now, just log (content is intentionally unused)
      void content; // Suppress unused variable warning
      this.logger.debug(`Would save artifact: ${safeFilename}`);
    } catch (error) {
      this.logger.error(`Failed to save artifact: ${filename}`);
      throw error;
    }
  }
}
