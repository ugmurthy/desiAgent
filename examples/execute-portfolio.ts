/*
An Indian investor has a portfolio allocated as 50% in Reliance Industries (RELIANCE.NS), 30% in HDFC Bank (HDFCBANK.NS), and 20% in Tata Motors (TATAMOTORS.NS). Using daily closing prices from January 1, 2025, to December 31, 2025, calculate the expected annual return and annual volatility of the portfolio based on historical data. Then, calculate the portfolio's beta against the Nifty 50 index (^NSEI). Finally, using the 10-year Indian Government bond yield as of December 31, 2025, as the risk-free rate, compute the Treynor ratio of the portfolio. Assume 250 trading days in a year and use logarithmic returns for calculations.

*/

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

   The Year now is 2026.
   
   An Indian investor has a portfolio allocated as 50% in Reliance Industries (RELIANCE.NS), 30% in HDFC Bank (HDFCBANK.NS), and 20% in Tata Motors (TATAMOTORS.NS).
    
   Search for daily closing prices from January 1, 2025, to December 31, 2025, calculate the expected annual return and annual volatility of the portfolio based on historical data. 
   
   Then, calculate the portfolio's beta against the Nifty 50 index (^NSEI). 
   
   Finally, look for the 10-year Indian Government bond yield as of December 31, 2025, as the risk-free rate, compute the Treynor ratio of the portfolio. 
   
   Assume 250 trading days in a year and use logarithmic returns for calculations.
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
