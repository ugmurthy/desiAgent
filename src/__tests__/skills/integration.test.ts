import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SkillRegistry } from '../../core/skills/registry.js';
import { MinimalSkillDetector } from '../../core/skills/detector.js';
import { resolve } from 'path';

// Mock homedir to avoid discovering real global skills
vi.mock('os', () => ({
  homedir: () => '/tmp/test-integration-no-such-dir',
}));

describe('Integration: skill discovery and detection', () => {
  let registry: SkillRegistry;

  beforeEach(async () => {
    // Point workspaceRoot to the actual project root so .agents/skills/ is found
    const workspaceRoot = resolve(__dirname, '..', '..', '..');
    registry = new SkillRegistry(workspaceRoot);
    await registry.discover();
  });

  it('discovers cataloging-apis from .agents/skills/', () => {
    const skill = registry.getByName('cataloging-apis');
    expect(skill).toBeDefined();
    expect(skill!.name).toBe('cataloging-apis');
    expect(skill!.source).toBe('workspace');
  });

  it('MinimalSkillDetector detects cataloging-apis for a relevant goal', () => {
    const detector = new MinimalSkillDetector();
    const detected = detector.detect(
      'Create API documentation for our SDK endpoints',
      registry.getAll(),
    );
    expect(detected).toContain('cataloging-apis');
  });

  it('getFormattedList includes cataloging-apis', () => {
    const formatted = registry.getFormattedList();
    expect(formatted).toContain('cataloging-apis');
  });
});
