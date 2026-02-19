#!/usr/bin/env bun
/**
 * init_6_memory_db.ts — In-memory database is now a first-class option.
 *
 * Pass databasePath: ':memory:' and everything works:
 * tables are created, agents are seeded, shutdown warns about data loss.
 *
 * Usage: bun run examples/init_6_memory_db.ts
 */

import { setupDesiAgent } from '../src/index.js';

const client = await setupDesiAgent({
  llmProvider: 'openrouter',
  openrouterApiKey: process.env.OPENROUTER_API_KEY,
  modelName: 'openai/gpt-4o',
  databasePath: ':memory:',
  logLevel: 'info',
});

console.log(`desiAgent v${client.version} running in-memory`);

// Agents are already seeded — list them
const agents = await client.agents.list();
console.log(`Seeded agents: ${agents.length}`);
for (const agent of agents.slice(0, 5)) {
  console.log(`  - ${agent.name} (v${agent.version})`);
}

// Shutdown warns about data loss
await client.shutdown();
// Output: WARN — Shutting down in-memory database — all data will be lost
