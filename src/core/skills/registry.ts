// SkillRegistry - Discovers and manages SKILL.md files from multiple locations.
//
// Discovery priority (first-match wins on name conflicts):
//   1. .agents/skills/<name>/SKILL.md  (workspace)
//   2. skills/<name>/SKILL.md          (workspace)
//   3. SKILL.md                        (workspace root)
//   4. ~/.config/agents/skills/<name>/SKILL.md (global)
//   5. ~/.desiAgent/skills/<name>/SKILL.md     (global)

import { z } from 'zod';
import { resolve } from 'path';
import { homedir } from 'os';
import { readdir, readFile, stat } from 'fs/promises';
import matter from 'gray-matter';
import { getLogger } from '../../util/logger.js';

export const SkillFrontmatterSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(10),
  type: z.enum(['context', 'executable']).default('context'),
  model: z.string().optional(),
  provider: z.string().optional(),
});

export interface SkillMeta {
  name: string;
  description: string;
  type: 'context' | 'executable';
  filePath: string;
  source: 'workspace' | 'global';
  model?: string;
  provider?: string;
}

export class SkillRegistry {
  private skills = new Map<string, SkillMeta>();
  private logger = getLogger();
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  async discover(): Promise<void> {
    const home = homedir();

    const locations: Array<{ pattern: 'glob' | 'root'; dir: string; source: 'workspace' | 'global' }> = [
      { pattern: 'glob', dir: resolve(this.workspaceRoot, '.agents', 'skills'), source: 'workspace' },
      { pattern: 'glob', dir: resolve(this.workspaceRoot, 'skills'), source: 'workspace' },
      { pattern: 'root', dir: this.workspaceRoot, source: 'workspace' },
      { pattern: 'glob', dir: resolve(home, '.config', 'agents', 'skills'), source: 'global' },
      { pattern: 'glob', dir: resolve(home, '.desiAgent', 'skills'), source: 'global' },
    ];

    for (const loc of locations) {
      try {
        if (loc.pattern === 'root') {
          await this.discoverRootSkill(loc.dir, loc.source);
        } else {
          await this.discoverGlobSkills(loc.dir, loc.source);
        }
      } catch {
        // Directory doesn't exist or isn't readable — skip silently
      }
    }

    this.logger.info({ count: this.skills.size }, 'Skill discovery complete');
  }

  private async discoverGlobSkills(dir: string, source: 'workspace' | 'global'): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const skillDir = resolve(dir, entry);
      const skillFile = resolve(skillDir, 'SKILL.md');

      try {
        const st = await stat(skillDir);
        if (!st.isDirectory()) continue;
      } catch {
        continue;
      }

      try {
        await stat(skillFile);
      } catch {
        continue;
      }

      await this.parseAndRegister(skillFile, entry, source);
    }
  }

  private async discoverRootSkill(dir: string, source: 'workspace' | 'global'): Promise<void> {
    const skillFile = resolve(dir, 'SKILL.md');
    try {
      await stat(skillFile);
    } catch {
      return;
    }
    await this.parseAndRegister(skillFile, null, source);
  }

  private async parseAndRegister(
    filePath: string,
    expectedDirName: string | null,
    source: 'workspace' | 'global',
  ): Promise<void> {
    try {
      const raw = await readFile(filePath, 'utf-8');
      const { data } = matter(raw);

      const parsed = SkillFrontmatterSchema.safeParse(data);
      if (!parsed.success) {
        this.logger.warn({ filePath, errors: parsed.error.format() }, 'Invalid SKILL.md frontmatter — skipping');
        return;
      }

      const meta = parsed.data;

      // Enforce name === directory name (root SKILL.md is exempt)
      if (expectedDirName !== null && meta.name !== expectedDirName) {
        this.logger.warn(
          { filePath, expected: expectedDirName, got: meta.name },
          'Skill name does not match directory name — skipping',
        );
        return;
      }

      // First-match wins
      if (this.skills.has(meta.name)) {
        this.logger.debug({ name: meta.name, filePath }, 'Skill already registered — skipping lower-priority duplicate');
        return;
      }

      this.skills.set(meta.name, {
        name: meta.name,
        description: meta.description,
        type: meta.type,
        filePath,
        source,
        model: meta.model,
        provider: meta.provider,
      });

      this.logger.debug({ name: meta.name, source, filePath }, 'Registered skill');
    } catch (err) {
      this.logger.warn({ filePath, err }, 'Failed to parse SKILL.md — skipping');
    }
  }

  async loadContent(name: string): Promise<string | undefined> {
    const skill = this.skills.get(name);
    if (!skill) return undefined;

    const raw = await readFile(skill.filePath, 'utf-8');
    const { content } = matter(raw);
    return content;
  }

  getAll(): SkillMeta[] {
    return Array.from(this.skills.values());
  }

  getByName(name: string): SkillMeta | undefined {
    return this.skills.get(name);
  }

  getFormattedList(): string {
    const all = this.getAll();
    if (all.length === 0) return 'No skills available.';

    return all
      .map(s => `- **${s.name}** (${s.type}): ${s.description}`)
      .join('\n');
  }
}
