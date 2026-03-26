import { describe, it, expect, beforeAll } from 'vitest';
import { SkillRegistry } from '../../core/skills/registry.js';
import { MinimalSkillDetector } from '../../core/skills/detector.js';
import { loadExecutableSkillHandler } from '../../core/skills/executableHandler.js';
import { resolve } from 'path';
import { homedir } from 'os';

describe('Integration: executable skill execution from ~/.desiAgent/skills', () => {
  let registry: SkillRegistry;

  beforeAll(async () => {
    const workspaceRoot = resolve(__dirname, '..', '..', '..');
    registry = new SkillRegistry(workspaceRoot);
    await registry.discover();
  });

  it('discovers git-expert from ~/.desiAgent/skills/ with source global', () => {
    const skill = registry.getByName('git-expert');
    expect(skill).toBeDefined();
    expect(skill!.name).toBe('git-expert');
    expect(skill!.source).toBe('global');
    expect(skill!.type).toBe('executable');
  });

  it('MinimalSkillDetector detects git-expert for a relevant goal', () => {
    const detector = new MinimalSkillDetector();
    const detected = detector.detect(
      'check git status of the repo',
      registry.getAll(),
    );
    expect(detected).toContain('git-expert');
  });

  describe('handler execution', () => {
    let handler: (args: { command: string; repoPath?: string }) => Promise<string>;

    beforeAll(async () => {
      const skill = registry.getByName('git-expert');
      expect(skill).toBeDefined();
      const loaded = await loadExecutableSkillHandler(skill!.name, skill!.filePath);
      handler = loaded.handler as (args: { command: string; repoPath?: string }) => Promise<string>;
      expect(typeof handler).toBe('function');
    });

    it('handler with { command: "status" } returns git status output', async () => {
      const result = await handler({ command: 'status' });
      expect(typeof result).toBe('string');
      // Git status output contains branch info or working tree status
      expect(result.length).toBeGreaterThan(0);
    });

    it('handler with { command: "log --oneline -5" } returns recent commit log', async () => {
      const result = await handler({ command: 'log --oneline -5' });
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('handler returns error string for invalid command', async () => {
      const result = await handler({ command: 'not-a-real-command' });
      expect(typeof result).toBe('string');
      expect(result).toContain('Git command failed');
    });
  });
});
