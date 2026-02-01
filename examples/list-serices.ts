/**
 * Example: List all Tools
 *
 * Run with: bun run examples/list-tools.ts
 * Options:
 *   --names    Only list tool names
 */

import { setupDesiAgent } from '../src/index.js';

async function main() {
  const namesOnly = process.argv.includes('--names');

  const client = await setupDesiAgent({
    llmProvider: 'openrouter',
    openrouterApiKey: process.env.OPENROUTER_API_KEY,
    modelName: 'openai/gpt-4o',
    logLevel: 'warn',
    databasePath: process.env.DATABASE_PATH
  });

  try {
    
    const client_l1=Object.keys(client);
     
  } catch (error) {
    console.error('Error listing tools:', error);
  }
}

main();
