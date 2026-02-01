/**
 * Example:  Execute a DAG give dagid
 *
 * Usage: bun run examples/execute-bg-dag-id.ts <dagId>
 */

import { setupDesiAgent } from '../src/index.js';

async function main(dagId: string) {
  const client = await setupDesiAgent({
    llmProvider: 'openrouter',
    openrouterApiKey: process.env.OPENROUTER_API_KEY,
    modelName: 'google/gemini-2.5-flash-lite-preview-09-2025',
    databasePath:process.env.DATABASE_PATH
  });

  try {
   
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

const usage = `Usage: bun run examples/execute-bg-dag-id.ts <dagId>

Arguments:
  dagId    The DAG ID to execute (e.g., dag_hTNxi7GVnTrSRoQgSofDg)

Options:
  -h, --help    Show this help message`;

const arg = process.argv[2];

if (arg === '-h' || arg === '--help') {
  console.log(usage);
  process.exit(0);
}

if (!arg) {
  console.error('Error: dagId is required\n');
  console.error(usage);
  process.exit(1);
}

main(arg);
