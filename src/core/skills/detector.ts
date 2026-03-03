// MinimalSkillDetector - Matches goal text to relevant skills via explicit triggers and keyword matching.

import type { SkillMeta } from './registry.js';

export interface SkillDetector {
  detect(goalText: string, skills: SkillMeta[]): string[];
}

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
  'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
  'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
  'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each',
  'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
  'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
  'just', 'because', 'but', 'and', 'or', 'if', 'while', 'about', 'up',
  'that', 'this', 'it', 'its', 'i', 'me', 'my', 'we', 'our', 'you',
  'your', 'he', 'him', 'his', 'she', 'her', 'they', 'them', 'their',
  'what', 'which', 'who', 'whom', 'use', 'when',
]);

export class MinimalSkillDetector implements SkillDetector {
  detect(goalText: string, skills: SkillMeta[]): string[] {
    const matched = new Set<string>();
    const lowerGoal = goalText.toLowerCase();

    // 1. Explicit triggers: 'use skill <name>', '--skill <name>', 'load skill <name>'
    const triggerPatterns = [
      /use\s+skill\s+(\S+)/gi,
      /--skill\s+(\S+)/gi,
      /load\s+skill\s+(\S+)/gi,
    ];

    for (const pattern of triggerPatterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(lowerGoal)) !== null) {
        const name = match[1].toLowerCase();
        for (const skill of skills) {
          if (skill.name.toLowerCase() === name) {
            matched.add(skill.name);
          }
        }
      }
    }

    // 2. Keyword matching fallback — match skill name tokens and description tokens against goal tokens
    const goalTokens = new Set(tokenize(lowerGoal));

    for (const skill of skills) {
      if (matched.has(skill.name)) continue;

      const nameTokens = tokenize(skill.name.toLowerCase());
      const descTokens = tokenize(skill.description.toLowerCase())
        .filter(t => !STOP_WORDS.has(t) && t.length > 2);

      const allKeywords = [...nameTokens, ...descTokens];

      for (const keyword of allKeywords) {
        if (goalTokens.has(keyword)) {
          matched.add(skill.name);
          break;
        }
      }
    }

    return Array.from(matched);
  }
}

function tokenize(text: string): string[] {
  return text.split(/[\s,.\-_:;!?'"()\[\]{}|/\\]+/).filter(t => t.length > 0);
}
