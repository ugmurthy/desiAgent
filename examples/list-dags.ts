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

async function main() {
  const client = await setupDesiAgent({
    llmProvider: 'openrouter',
    openrouterApiKey: process.env.OPENROUTER_API_KEY,
    modelName: 'openai/gpt-4o',
    logLevel: 'warn',
  });

  try {
    // List all DAGs
    console.log('Listing all DAGs...\n');
    const allDags = await client.dags.list();

    if (allDags.length === 0) {
      console.log('No DAGs found.');
    } else {
      console.log(`Found ${allDags.length} DAG(s):\n`);

      for (const dag of allDags) {
        console.log(`ID: ${dag.id}`);
        console.log(`  Objective: ${dag.objective}`);
        console.log(`  Status: ${dag.status}`);
        console.log(`  Created: ${dag.createdAt}`);
        console.log(`  Updated: ${dag.updatedAt}`);
        if (dag.metadata?.cronSchedule) {
          console.log(`  Schedule: ${dag.metadata.cronSchedule} (active: ${dag.metadata.scheduleActive})`);
        }
        console.log('');
      }
    }

    // List only successful DAGs
    console.log('--- Filtering by status "success" ---\n');
    const successDags = await client.dags.list({ status: 'success' });
    console.log(`Found ${successDags.length} successful DAG(s)`);

    // List scheduled DAGs
    console.log('\n--- Scheduled DAGs ---\n');
    const scheduledDags = await client.dags.listScheduled();
    if (scheduledDags.length === 0) {
      console.log('No scheduled DAGs found.');
    } else {
      for (const dag of scheduledDags) {
        console.log(`ID: ${dag.id}`);
        console.log(`  Title: ${dag.dagTitle}`);
        console.log(`  Schedule: ${dag.scheduleDescription}`);
        console.log(`  Active: ${dag.scheduleActive}`);
        console.log('');
      }
    }
  } catch (error) {
    console.error('Error listing DAGs:', error);
  } finally {
    await client.shutdown();
  }
}

main();
