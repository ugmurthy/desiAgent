#!/usr/bin/env bun
/**
 * init_1_api_keys.ts — API keys are now resolved by provider inside resolveConfig().
 *
 * The OPENROUTER_API_KEY env-var fallback in factory.ts is gone.
 * You must pass the correct key field for your chosen provider.
 *
 * Usage: bun run examples/init_1_api_keys.ts
 */

import { setupDesiAgent } from '../src/index.js';

// ✅ Correct: pass openrouterApiKey for openrouter provider
const client = await setupDesiAgent({
  llmProvider: 'openrouter',
  openrouterApiKey: process.env.OPENROUTER_API_KEY,  // ← must be explicit
  modelName: 'openai/gpt-4o',
  databasePath: ':memory:',
  logLevel: 'info',
});

console.log(`desiAgent v${client.version} initialised with openrouter`);
await client.shutdown();

// ❌ This will NOT work anymore — factory no longer falls back to process.env:
//
// const client2 = await setupDesiAgent({
//   llmProvider: 'openrouter',
//   // missing openrouterApiKey — used to work via env fallback, now throws
//   modelName: 'openai/gpt-4o',
// });
