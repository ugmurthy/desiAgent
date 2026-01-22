#!/usr/bin/env bun
/**
 
 * Run with: 
 *   bun run examples/execute-goal.ts -f goal.txt
 *   echo "my goal" | bun run examples/execute-goal.ts
 */

import { setupDesiAgent } from '../src/index.js';
import { parseArgs } from 'util';
import { readFileSync } from 'fs';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8').trim();
}

async function getGoal(): Promise<string> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      f: { type: 'string' },
    },
  });

  if (values.f) {
    return readFileSync(values.f, 'utf-8').trim();
  }

  if (!process.stdin.isTTY) {
    return readStdin();
  }

  console.log('No goal provided. Use -f <filename> or pipe input via stdin.');
  process.exit(1);
}

async function main() {
  const goal = await getGoal();
  console.log('Goal:', goal.slice(0, 100) + (goal.length > 100 ? '...' : ''));

  const client = await setupDesiAgent({
    llmProvider: 'openrouter',
    openrouterApiKey: process.env.OPENROUTER_API_KEY,
    modelName: 'google/gemini-2.5-flash-lite-preview-09-2025',
    logLevel: 'info',
  });

  try {
    console.log('Creating DAG from goal...\n');
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
