/**
 * Example: Execute given a execution id
 *
 * This example demonstrates how to:
 * 1. Initialize the desiAgent client
 * 2. Execute given a execution id
 * 
 * Run with: bun run examples/execute-id.ts
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
    
    // Execute given execution id
    const executionId = 'exec_i1GboFIaiwFhiSQpUNxYc';
    console.log(`\nExecuting . ${executionId}`);
    
    const execution = await client.executions.get(executionId);
  
    console.log(`**** execution result: ${JSON.stringify(execution,null,2)}`)
    if (execution.status === 'completed') {
      console.log(`**** execution completed: ${execution.status} CANNOT RESUME`)
      console.log("--------------------------------")
      console.log(`${execution.finalResult}`)
      console.log("--------------------------------")
    } else {
      console.log(`**** execution status: ${execution.status} CAN RESUME`)
      const ret_val = await client.dags.resume(executionId);
      console.log(`**** resume result: ${JSON.stringify(ret_val,null,2)}`)
    
      // Wait for execution to complete
      for await (const event of client.executions.streamEvents(executionId)) {
        console.log('Event:', event.type, event.data);
      }


    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.shutdown();
  }
}

main();
