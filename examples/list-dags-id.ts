/**
 * Example: List all DAGs
 *
 * This example demonstrates how to:
 * 1. Initialize the desiAgent client
 * 2. List all DAGs with optional filtering
 * 3. Display DAG information
 *
 * Run with: bun run examples/list-dags-id.ts <dagId>
 */

import { setupDesiAgent } from '../src/index.js';

const dagId = process.argv[2];

if (!dagId) {
  console.error('Usage: bun run examples/list-dags-id.ts <dagId>');
  process.exit(1);
}
async function main() {
  const client = await setupDesiAgent({
    llmProvider: 'openrouter',
    openrouterApiKey: process.env.OPENROUTER_API_KEY,
    modelName: 'openai/gpt-4o',
    logLevel: 'warn',
    databasePath: process.env.DATABASE_PATH
  });
  
  try {
    const dag = await client.dags.get(dagId)
    console.log(`${JSON.stringify(dag,null,2)}`)
 
  } catch (error) {
    console.error('Error listing DAGs:', error);
  } finally {
    await client.shutdown();
  }
}

main();
