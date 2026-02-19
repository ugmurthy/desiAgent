#!/usr/bin/env bun
/**
 * init_5_resolveConfig.ts — New exports: ResolvedConfig, resolveConfig, seedAgents.
 *
 * Use resolveConfig() if you need programmatic access to the frozen config
 * without going through setupDesiAgent().
 *
 * Usage: bun run examples/init_5_resolveConfig.ts
 */

import { DesiAgentConfigSchema, resolveConfig } from '../src/types/config.js';
import type { ResolvedConfig } from '../src/types/config.js';

// Step 1: validate raw input via Zod
const validated = DesiAgentConfigSchema.parse({
  llmProvider: 'openrouter',
  openrouterApiKey: 'sk-test-key',
  modelName: 'openai/gpt-4o',
  databasePath: ':memory:',
});

// Step 2: resolve all defaults into a frozen object
const resolved: ResolvedConfig = resolveConfig(validated);

console.log('Resolved config:');
console.log('  databasePath:', resolved.databasePath);
console.log('  isMemoryDb:', resolved.isMemoryDb);
console.log('  artifactsDir:', resolved.artifactsDir);
console.log('  llmProvider:', resolved.llmProvider);
console.log('  apiKey:', resolved.apiKey ? '***' : 'undefined');
console.log('  logLevel:', resolved.logLevel);
console.log('  logDest:', resolved.logDest);
console.log('  staleExecutionMinutes:', resolved.staleExecutionMinutes);
console.log('  smtp.host:', resolved.smtp.host ?? '(not set)');
console.log('  imap.host:', resolved.imap.host);

// The object is frozen — mutations throw in strict mode
try {
  (resolved as any).logLevel = 'debug';
} catch {
  console.log('\n✅ Config is frozen — cannot mutate');
}
