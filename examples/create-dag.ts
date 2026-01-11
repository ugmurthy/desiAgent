/**
 * Example: Create a DAG from a goal using DecomposerV8 agent
 *
 * This example demonstrates how to:
 * 1. Initialize the desiAgent client
 * 2. Create a DAG from goal text
 * 3. Handle the result (success, clarification required, or unpersisted)
 *
 * Run with: bun run examples/create-dag.ts
 */

import { setupDesiAgent } from '../src/index.js';

async function main() {
  const client = await setupDesiAgent({
    llmProvider: process.env.LLM_PROVIDER,
    openrouterApiKey: process.env.OPENROUTER_API_KEY,
    modelName: process.env.LLM_MODEL,
    logLevel: 'info',
  });

  try {
    console.log('Creating DAG from goal...\n');

    const result = await client.dags.createFromGoal({
      goalText: 'Get latest news on Athletics and Cricket',
      agentName: 'DecomposerV8',
      temperature: 0.7,
    });

    console.log('Result status:', result.status);

    if (result.status === 'success' && 'dagId' in result) {
      console.log('DAG created successfully!');
      console.log('DAG ID:', result.dagId);

      // Fetch and display the DAG details
      const dag = await client.dags.get(result.dagId);
      console.log('\nDAG Details:');
      console.log('  Objective:', dag.objective);
      console.log('  Status:', dag.status);
      console.log('  Created:', dag.createdAt);
    } else if (result.status === 'clarification_required') {
      console.log('Clarification needed:');
      console.log('  Query:', result.clarificationQuery);
    } else if (result.status === 'success' && 'result' in result) {
      console.log('DAG created (unpersisted):');
      console.log('  Attempts:', result.attempts);
      console.log('  Usage:', result.usage);
    }
  } catch (error) {
    console.error('Error creating DAG:', error);
  } finally {
    await client.shutdown();
  }
}

main();
