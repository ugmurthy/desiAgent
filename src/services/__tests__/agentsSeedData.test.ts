import { describe, it, expect } from 'vitest';
import { agentsSeedData } from '../agentsSeedData.js';
import type { AgentSeedData } from '../agentsSeedData.js';

describe('agentsSeedData', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(agentsSeedData)).toBe(true);
    expect(agentsSeedData.length).toBeGreaterThan(0);
  });

  it('each entry has all required fields', () => {
    const requiredKeys: (keyof AgentSeedData)[] = [
      'id', 'name', 'version', 'prompt_template',
      'provider', 'model', 'active', 'metadata',
      'created_at', 'updated_at',
    ];

    for (const entry of agentsSeedData) {
      for (const key of requiredKeys) {
        expect(entry).toHaveProperty(key);
      }
    }
  });

  it('each entry has a unique id', () => {
    const ids = agentsSeedData.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('each entry has a unique name', () => {
    const names = agentsSeedData.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('each active entry has a non-empty prompt_template', () => {
    const activeEntries = agentsSeedData.filter((e) => e.active);
    expect(activeEntries.length).toBeGreaterThan(0);

    for (const entry of activeEntries) {
      expect(entry.prompt_template.trim().length).toBeGreaterThan(0);
    }
  });

  it('created_at and updated_at are valid ISO date strings', () => {
    for (const entry of agentsSeedData) {
      expect(new Date(entry.created_at).toISOString()).toBe(entry.created_at);
      expect(new Date(entry.updated_at).toISOString()).toBe(entry.updated_at);
    }
  });
});
