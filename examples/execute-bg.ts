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
    I would like you to look up different resources about the "Bhagwath Geeta" and evaluate those suitable for studying this collection of wisdom. Develop a guide titled Bhagwat-Geeta-Guide.md to help people learn about it. This guide needs to be appropriate for beginners who have zero prior knowledge of the Bhagwath Geeta.
      - The guide should emphasize a mix of historical background, philosophical ideas, and real-world uses.
      - The guide should cover elements such as (for example, basics of Sanskrit, main figures, overviews of the chapters, suggested books or materials).
      - Keep the tone neutral yet engaging and approachable.
      Once the guide is complete, send it via email to ugmurthy@gmail.com.
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
