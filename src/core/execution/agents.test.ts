import { describe, test, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from '../../db/schema.js';
import { AgentsService } from './agents.js';
import { generateAllSQL } from '../../services/initDB.js';

function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  const { sql } = generateAllSQL();
  sqlite.exec(sql);
  return drizzle(sqlite, { schema });
}

describe('AgentsService.update', () => {
  let db: ReturnType<typeof createTestDb>;
  let service: AgentsService;
  let agentId: string;

  beforeEach(async () => {
    db = createTestDb();
    service = new AgentsService(db);
    const created = await service.create(
      'test-agent',
      '1.0',
      'You are a test agent',
      { provider: 'openai', model: 'gpt-4o', metadata: { key1: 'value1' } }
    );
    agentId = created.id;
  });

  test('updates name correctly', async () => {
    const updated = await service.update(agentId, { name: 'renamed-agent' } as any);
    expect(updated.name).toBe('renamed-agent');
  });

  test('updates version correctly', async () => {
    const updated = await service.update(agentId, { version: '2.0' } as any);
    expect(updated.version).toBe('2.0');
  });

  test('updates systemPrompt correctly', async () => {
    const updated = await service.update(agentId, { systemPrompt: 'New prompt' } as any);
    expect(updated.systemPrompt).toBe('New prompt');
  });

  test('updates provider correctly', async () => {
    const updated = await service.update(agentId, { provider: 'ollama' } as any);
    expect(updated.provider).toBe('ollama');
  });

  test('updates model correctly', async () => {
    const updated = await service.update(agentId, { model: 'gpt-3.5-turbo' } as any);
    expect(updated.model).toBe('gpt-3.5-turbo');
  });

  test('updates isActive correctly', async () => {
    const updated = await service.update(agentId, { isActive: true } as any);
    expect(updated.isActive).toBe(true);
  });

  test('updates metadata correctly', async () => {
    const updated = await service.update(agentId, { metadata: { newKey: 'newValue' } } as any);
    expect(updated.metadata).toEqual({ newKey: 'newValue' });
  });

  test('updates description correctly (stored in metadata)', async () => {
    const updated = await service.update(agentId, { description: 'A test description' } as any);
    expect(updated.description).toBe('A test description');
    expect(updated.metadata?.description).toBe('A test description');
  });

  test('BUG: description preserves existing metadata', async () => {
    // First set some metadata
    await service.update(agentId, { metadata: { key1: 'value1', key2: 'value2' } } as any);
    // Now update only description - existing metadata keys should be preserved
    const updated = await service.update(agentId, { description: 'Updated desc' } as any);
    expect(updated.description).toBe('Updated desc');
    expect(updated.metadata?.key1).toBe('value1');
    expect(updated.metadata?.key2).toBe('value2');
  });

  test('BUG: sending both metadata and description preserves both', async () => {
    const updated = await service.update(agentId, {
      metadata: { foo: 'bar' },
      description: 'My description',
    } as any);
    expect(updated.description).toBe('My description');
    expect(updated.metadata?.foo).toBe('bar');
    expect(updated.metadata?.description).toBe('My description');
  });

  test('BUG: constraints.maxTokens should NOT overwrite model', async () => {
    const updated = await service.update(agentId, {
      constraints: { maxTokens: 4096 },
    } as any);
    // model should remain unchanged, not be set to 4096
    expect(updated.model).toBe('gpt-4o');
    expect(typeof updated.model).toBe('string');
  });

  test('BUG: constraints.maxTokens with model update - model should win', async () => {
    const updated = await service.update(agentId, {
      constraints: { maxTokens: 4096 },
      model: 'gpt-3.5-turbo',
    } as any);
    expect(updated.model).toBe('gpt-3.5-turbo');
  });

  test('constraints stored in metadata, not overwriting model', async () => {
    const updated = await service.update(agentId, {
      constraints: { maxTokens: 4096, temperature: 0.7 },
    } as any);
    expect(updated.model).toBe('gpt-4o');
    expect(updated.metadata?.constraints).toEqual({ maxTokens: 4096, temperature: 0.7 });
  });

  test('all three: metadata + description + constraints preserved together', async () => {
    const updated = await service.update(agentId, {
      metadata: { foo: 'bar' },
      description: 'My desc',
      constraints: { maxTokens: 2048 },
    } as any);
    expect(updated.metadata?.foo).toBe('bar');
    expect(updated.metadata?.description).toBe('My desc');
    expect(updated.metadata?.constraints).toEqual({ maxTokens: 2048 });
    expect(updated.model).toBe('gpt-4o');
  });

  test('updates updatedAt timestamp on every update', async () => {
    const before = await service.get(agentId);
    // Small delay to ensure timestamp differs
    await new Promise((r) => setTimeout(r, 50));
    const updated = await service.update(agentId, { name: 'time-test' } as any);
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(before.updatedAt.getTime());
  });
});
