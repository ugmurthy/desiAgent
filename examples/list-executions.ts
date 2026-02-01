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

import { exec } from 'child_process';
import { setupDesiAgent } from '../src/index.js';

async function main() {
  const client = await setupDesiAgent({
    llmProvider: 'openrouter',
    openrouterApiKey: process.env.OPENROUTER_API_KEY,
    modelName: 'openai/gpt-4o',
    logLevel: 'silent',
    databasePath: process.env.DATABASE_PATH
  });

 
  try {
    // List all DAGs
    console.log('Listing all Executions...\n');
    const allExecutions = await client.executions.list();

    if (allExecutions.length === 0) {
      console.log('No Executions found.');
    } else {
      console.log(`Found ${allExecutions.length} Execution(s):\n`);
      //console.log(JSON.stringify(allDags[0],null,2));

      for (const execution of allExecutions) {
        console.error(`\n\nID: ${execution.id} : ${ execution.status} ${execution.dagId}`);
        const e = await client.executions.get(execution.id);
        const st = await client.executions.getSubSteps(execution.id);
        //console.log(`${JSON.stringify(e,null,2)}`)
        //console.log(`Substep ${JSON.stringify(st[0])}`)
        for (const step of st) {
          console.log(`╰─${step.taskId} : ${step.status} ${step.toolOrPromptName}\n\t╰─Relies on result of: ${step.dependencies}\n\t╰─${step.thought}\n\t╰─${step.description}`);
        }
        

      }
    }

  } catch (error) {
    console.error('Error listing DAGs:', error);
  } finally {
    await client.shutdown();
  }
}

main();
