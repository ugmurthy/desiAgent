#!/usr/bin/env bun
/**
 * Run an executable skill from the command line.
 *
 * Usage:
 *   bun examples/run-skill.ts <skill-name> [json-params]
 *
 * Examples:
 *   bun examples/run-skill.ts git-expert '{"command":"status"}'
 *   bun examples/run-skill.ts git-expert '{"command":"log --oneline -5"}'
 *
 * Without params it lists all discovered skills.
 *   bun examples/run-skill.ts
 */

import { resolve } from 'path';
import { SkillRegistry } from '@ugm/desiagent';

const [skillName, rawParams] = process.argv.slice(2);

const registry = new SkillRegistry(process.cwd());
await registry.discover();

// No arguments → list all skills
if (!skillName) {
  const all = registry.getAll();
  if (all.length === 0) {
    console.log('No skills discovered.');
  } else {
    console.log('Discovered skills:\n');
    for (const s of all) {
      console.log(`  ${s.name} (${s.type}) — ${s.description}`);
      console.log(`    source: ${s.source}  path: ${s.filePath}\n`);
    }
  }
  process.exit(0);
}

// Look up the skill
const skill = registry.getByName(skillName);
if (!skill) {
  console.error(`Skill not found: ${skillName}`);
  console.error('Available:', registry.getAll().map(s => s.name).join(', '));
  process.exit(1);
}

if (skill.type !== 'executable') {
  console.error(`Skill "${skillName}" is type "${skill.type}" (not executable).`);
  console.error('Context skills are injected into LLM prompts — they cannot be run directly.');
  process.exit(1);
}

// Import and run the handler
const handlerPath = resolve(skill.filePath, '..', 'handler.ts');
let handler: (params: Record<string, unknown>) => Promise<string>;
try {
  const mod = await import(`file://${handlerPath}`);
  handler = mod.default ?? mod.handler;
  if (typeof handler !== 'function') {
    throw new Error('No default or named "handler" export found');
  }
} catch (err) {
  console.error(`Failed to load handler at ${handlerPath}:`, err);
  process.exit(1);
}

const params = rawParams ? JSON.parse(rawParams) : {};
console.log(`Running skill "${skillName}" with params:`, params, '\n');

const result = await handler(params);
console.log(result);
