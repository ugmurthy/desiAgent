import { describe, it, expect } from 'vitest';
import { MinimalSkillDetector } from '../../core/skills/detector.js';
import type { SkillMeta } from '../../core/skills/registry.js';

function makeMeta(name: string, description: string): SkillMeta {
  return {
    name,
    description,
    type: 'context',
    filePath: `/fake/path/${name}/SKILL.md`,
    source: 'workspace',
  };
}

const catalogingApis = makeMeta(
  'cataloging-apis',
  'Documents SDK or backend API surfaces with concise, accurate inputs/outputs and per-endpoint error shapes.',
);

const frontendDesign = makeMeta(
  'frontend-design',
  'Create distinctive production-grade frontend interfaces with high design quality.',
);

const skills: SkillMeta[] = [catalogingApis, frontendDesign];

describe('MinimalSkillDetector', () => {
  const detector = new MinimalSkillDetector();

  describe('explicit triggers', () => {
    it("'use skill cataloging-apis' returns ['cataloging-apis']", () => {
      const result = detector.detect('use skill cataloging-apis', skills);
      expect(result).toEqual(['cataloging-apis']);
    });

    it("'--skill cataloging-apis' returns ['cataloging-apis']", () => {
      const result = detector.detect('--skill cataloging-apis', skills);
      expect(result).toEqual(['cataloging-apis']);
    });

    it("'load skill cataloging-apis' returns ['cataloging-apis']", () => {
      const result = detector.detect('load skill cataloging-apis', skills);
      expect(result).toEqual(['cataloging-apis']);
    });

    it('is case-insensitive for explicit triggers', () => {
      const result = detector.detect('USE SKILL cataloging-apis', skills);
      expect(result).toEqual(['cataloging-apis']);
    });
  });

  describe('keyword matching', () => {
    it('goal text containing skill description keywords returns matching skill names', () => {
      const result = detector.detect('I need to document the API surfaces of our SDK', skills);
      expect(result).toContain('cataloging-apis');
    });

    it('unrelated goal text returns empty array', () => {
      const result = detector.detect('walk the dog and buy groceries', skills);
      expect(result).toEqual([]);
    });

    it('matching is case-insensitive', () => {
      const result = detector.detect('DOCUMENT THE API SURFACES', skills);
      expect(result).toContain('cataloging-apis');
    });
  });

  describe('deduplication', () => {
    it('duplicate matches are deduplicated', () => {
      // Explicit trigger + keyword match should still produce one entry
      const result = detector.detect('use skill cataloging-apis and document API surfaces', skills);
      const count = result.filter(n => n === 'cataloging-apis').length;
      expect(count).toBe(1);
    });
  });

  describe('multiple skills', () => {
    it('can match multiple skills from one goal', () => {
      const result = detector.detect('document API surfaces and create frontend interfaces', skills);
      expect(result).toContain('cataloging-apis');
      expect(result).toContain('frontend-design');
    });
  });
});
