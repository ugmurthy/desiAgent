/**
 * Example: Create and Execute a DAG
 *
 * This example demonstrates how to:
 * 1. Initialize the desiAgent client
 * 2. Create a DAG from goal text
 * 3. Execute the created DAG
 * 4. Monitor execution status
 *
 * Run with: bun run examples/execute-dag.ts
 */

import { setupDesiAgent } from '../src/index.js';

async function main() {
  const client = await setupDesiAgent({
    llmProvider: 'openrouter',
    openrouterApiKey: process.env.OPENROUTER_API_KEY,
    modelName: 'google/gemini-2.5-flash-lite-preview-09-2025',
    logLevel: 'info',
  });

  try {
    console.log('Creating DAG from goal...\n');
    const goal = `
  A factory produces three types of products: P1, P2, and P3. Each product requires processing time on two machines, M1 and M2. P1 requires 2 hours on M1 and 3 hours on M2, with a profit of $5 per unit. P2 requires 4 hours on M1 and 1 hour on M2, with a profit of $4 per unit. P3 requires 1 hour on M1 and 2 hours on M2, with a profit of $3 per unit. The factory has 100 hours available on M1 and 80 hours on M2 per week. Additionally, due to market demand, at most 20 units of P1 can be sold, and at least 10 units of P2 must be produced. The number of units produced for each product must be non-negative integers. Determine the number of units of each product to produce to maximize the total profit.

  Provide the solution in a markdown table with the optimal number of units for each product and the total profit.
    `
    const createResult = await client.dags.createFromGoal({
      goalText: goal,
      agentName: 'DecomposerV8',
      temperature: 0.7,
    });

    if (createResult.status !== 'success' || !('dagId' in createResult)) {
      console.log('DAG creation did not return a dagId:', createResult.status);
      if (createResult.status === 'clarification_required') {
        console.log('Clarification needed:', createResult.clarificationQuery);
      }
      return;
    }

    const dagId = createResult.dagId;
    console.log('DAG created with ID:', dagId);

    // Execute the DAG
    console.log('\nExecuting DAG...');
    const execution = await client.dags.execute(dagId);

    
    console.log('Execution started!');
    console.log('  Execution ID:', execution.id);
    console.log('  Status:', execution.status);
    
    
    // Wait for execution to complete
    for await (const event of client.executions.streamEvents(execution.id)) {
      console.log('Event:', event.type, event.data);
    }

    // Get execution details with substeps
    const executionDetails = await client.executions.getWithSubSteps(execution.id);
    console.log('\nExecution Details:');
    console.log('  Status:', executionDetails.status);
    console.log('  SubSteps count:', executionDetails.subSteps?.length ?? 0);

    if (executionDetails.subSteps && executionDetails.subSteps.length > 0) {
      console.log('\nSubSteps:');
      for (const step of executionDetails.subSteps) {
        console.log(`  - Task ${step.taskId}: ${step.status}`);
      }
    }


  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.shutdown();
  }
}

main();
