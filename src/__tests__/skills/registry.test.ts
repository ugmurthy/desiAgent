import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { SkillRegistry } from '../../core/skills/registry.js';

// Mock the logger to capture warnings
vi.mock('../../util/logger.js', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock homedir so discovery doesn't pick up real global skills
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return {
    ...actual,
    homedir: () => '/tmp/skill-registry-fake-home-that-does-not-exist',
  };
});

let tempDir: string;

async function writeSkillMD(dir: string, name: string, frontmatter: Record<string, string>): Promise<void> {
  const skillDir = join(dir, name);
  await mkdir(skillDir, { recursive: true });
  const fm = Object.entries(frontmatter)
    .map(([k, v]) => `${k}: "${v}"`)
    .join('\n');
  await writeFile(join(skillDir, 'SKILL.md'), `---\n${fm}\n---\n\n# ${name}\n\nSkill body content for ${name}.`);
}

describe('SkillRegistry', () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'skill-registry-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('discovers skills from .agents/skills/ subdirectories', async () => {
    const agentsSkillsDir = join(tempDir, '.agents', 'skills');
    await writeSkillMD(agentsSkillsDir, 'my-skill', {
      name: 'my-skill',
      description: 'A test skill for discovery verification',
    });

    const registry = new SkillRegistry(tempDir);
    await registry.discover();

    const all = registry.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('my-skill');
    expect(all[0].source).toBe('workspace');
  });

  it('higher-priority location wins on name conflict', async () => {
    // .agents/skills has higher priority than skills/
    const agentsDir = join(tempDir, '.agents', 'skills');
    const skillsDir = join(tempDir, 'skills');

    await writeSkillMD(agentsDir, 'conflict-skill', {
      name: 'conflict-skill',
      description: 'High priority version of this skill',
    });
    await writeSkillMD(skillsDir, 'conflict-skill', {
      name: 'conflict-skill',
      description: 'Low priority version of this skill',
    });

    const registry = new SkillRegistry(tempDir);
    await registry.discover();

    const skill = registry.getByName('conflict-skill');
    expect(skill).toBeDefined();
    expect(skill!.description).toBe('High priority version of this skill');
    expect(skill!.filePath).toContain('.agents');
  });

  it('skips skills with name/directory mismatch (logs warning)', async () => {
    const agentsDir = join(tempDir, '.agents', 'skills');
    await writeSkillMD(agentsDir, 'dir-name', {
      name: 'mismatched-name',
      description: 'This skill has a name that does not match the directory',
    });

    const registry = new SkillRegistry(tempDir);
    await registry.discover();

    expect(registry.getAll()).toHaveLength(0);
    expect(registry.getByName('mismatched-name')).toBeUndefined();
  });

  it('skips skills with invalid/missing frontmatter (logs warning, no crash)', async () => {
    const agentsDir = join(tempDir, '.agents', 'skills');
    const skillDir = join(agentsDir, 'bad-skill');
    await mkdir(skillDir, { recursive: true });

    // Missing required fields
    await writeFile(join(skillDir, 'SKILL.md'), '---\ntitle: oops\n---\n\nNo valid frontmatter here.');

    const registry = new SkillRegistry(tempDir);
    // Should not throw
    await expect(registry.discover()).resolves.toBeUndefined();
    expect(registry.getAll()).toHaveLength(0);
  });

  it('loadContent() returns the markdown body (not frontmatter)', async () => {
    const agentsDir = join(tempDir, '.agents', 'skills');
    await writeSkillMD(agentsDir, 'body-skill', {
      name: 'body-skill',
      description: 'A skill to test body content loading',
    });

    const registry = new SkillRegistry(tempDir);
    await registry.discover();

    const content = await registry.loadContent('body-skill');
    expect(content).toBeDefined();
    expect(content).toContain('Skill body content for body-skill');
    // Should not contain frontmatter delimiters
    expect(content).not.toContain('---');
  });

  it('getFormattedList() returns formatted string with all skills', async () => {
    const agentsDir = join(tempDir, '.agents', 'skills');
    await writeSkillMD(agentsDir, 'skill-alpha', {
      name: 'skill-alpha',
      description: 'Alpha skill for formatting test',
    });
    await writeSkillMD(agentsDir, 'skill-beta', {
      name: 'skill-beta',
      description: 'Beta skill for formatting test verification',
    });

    const registry = new SkillRegistry(tempDir);
    await registry.discover();

    const list = registry.getFormattedList();
    expect(list).toContain('skill-alpha');
    expect(list).toContain('skill-beta');
    expect(list).toContain('Alpha skill');
    expect(list).toContain('Beta skill');
  });

  it('getByName() returns correct skill or undefined', async () => {
    const agentsDir = join(tempDir, '.agents', 'skills');
    await writeSkillMD(agentsDir, 'findable', {
      name: 'findable',
      description: 'A skill that should be findable by name',
    });

    const registry = new SkillRegistry(tempDir);
    await registry.discover();

    const found = registry.getByName('findable');
    expect(found).toBeDefined();
    expect(found!.name).toBe('findable');

    const notFound = registry.getByName('nonexistent');
    expect(notFound).toBeUndefined();
  });

  it('loadContent() returns undefined for unknown skill', async () => {
    const registry = new SkillRegistry(tempDir);
    await registry.discover();

    const content = await registry.loadContent('no-such-skill');
    expect(content).toBeUndefined();
  });

  it('getFormattedList() returns fallback when no skills', async () => {
    const registry = new SkillRegistry(tempDir);
    await registry.discover();

    expect(registry.getFormattedList()).toBe('No skills available.');
  });
});
