#!/usr/bin/env bun
/**
 * list-sdk-methods.ts - List all services and methods in desiClient API SDK
 * Usage: bun run list-sdk-methods.ts
 */

import { setupDesiAgent } from '../src/index.js';

  const client = await setupDesiAgent({
    llmProvider: 'openrouter',
    openrouterApiKey: process.env.OPENROUTER_API_KEY,
    modelName: 'openai/gpt-4o',
    logLevel: 'silent',
    databasePath: process.env.DATABASE_PATH
  });

const services = [
  'auth',
  'users',
  'agents',
  'dags',
  'executions',
  'tools',
  'costs',
  'billing',
  'admin',
] as const;

console.log(`== desiAgent (${client.version}) - Services and Methods ===\n`);

// List root-level methods on ApiClient
const rootMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(client))
  .filter((name) => name !== 'constructor' && typeof (client as any)[name] === 'function');

if (rootMethods.length > 0) {
  console.log('ApiClient (root methods):');
  rootMethods.forEach((method) => {
    console.log(`  - ${method}()`);
  });
  console.log();
}

// List methods for each service
for (const serviceName of services) {
  const service = (client as any)[serviceName];
  if (!service) continue;

  const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(service))
    .filter((name) => name !== 'constructor' && typeof service[name] === 'function');

  console.log(`${serviceName}:`);
  methods.forEach((method) => {
    console.log(`  - ${method}()`);
  });
  console.log();
}
