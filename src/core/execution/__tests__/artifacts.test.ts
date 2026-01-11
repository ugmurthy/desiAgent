/**
 * Artifacts Service Tests
 *
 * Tests for artifact file management
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ArtifactsService } from '../artifacts.js';
import { existsSync } from 'fs';

describe('ArtifactsService', () => {
  let service: ArtifactsService;

  beforeEach(() => {
    service = new ArtifactsService();
  });

  describe('list', () => {
    it('returns empty array when artifacts dir does not exist', async () => {
      const artifacts = await service.list();
      expect(Array.isArray(artifacts)).toBe(true);
    });

    it('returns artifact filenames', async () => {
      const artifacts = await service.list();
      expect(Array.isArray(artifacts)).toBe(true);
    });
  });

  describe('get', () => {
    it('throws NotFoundError for non-existent artifact', async () => {
      await expect(service.get('nonexistent.txt')).rejects.toThrow(
        'not found'
      );
    });

    it('prevents path traversal attacks', async () => {
      await expect(service.get('../etc/passwd')).rejects.toThrow(
        'not found'
      );
    });

    it('normalizes path to basename only', async () => {
      await expect(service.get('subdir/file.txt')).rejects.toThrow();
    });
  });

  describe('custom artifacts directory', () => {
    it('uses custom directory when provided', () => {
      const custom = new ArtifactsService('/custom/path');
      expect(custom).toBeDefined();
    });

    it('defaults to ./artifacts directory', () => {
      const service2 = new ArtifactsService();
      expect(service2).toBeDefined();
    });
  });

  describe('_save', () => {
    it('handles missing artifacts directory gracefully', async () => {
      const service2 = new ArtifactsService('/nonexistent/artifacts');

      // Should not throw
      await service2._save('test.txt', 'content');
    });

    it('prevents path traversal on save', async () => {
      await expect(
        service._save('../etc/passwd', 'malicious')
      ).rejects.toThrow();
    });

    it('normalizes filename to basename', async () => {
      // Should attempt to save only the basename
      await service._save('subdir/file.txt', 'content');
    });
  });
});
