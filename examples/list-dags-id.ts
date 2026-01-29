/**
 * Example: List all DAGs
 *
 * This example demonstrates how to:
 * 1. Initialize the desiAgent client
 * 2. List all DAGs with optional filtering
 * 3. Display DAG information
 *
 * Run with: bun run examples/list-dags.ts
 */

import { setupDesiAgent } from '../src/index.js';
const dagId = "dag_EbvukFKKz6P4CveL-_sj_";
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
