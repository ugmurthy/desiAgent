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
import { groupBy } from 'lodash';

async function main() {
  const client = await setupDesiAgent({
    llmProvider: 'openrouter',
    openrouterApiKey: process.env.OPENROUTER_API_KEY,
    modelName: 'openai/gpt-4o',
    logLevel: 'silent',
    databasePath: process.env.DATABASE_PATH
  });


  try {
    const executionId= "exec_9YZrrBjGceEkIU076jaeD";
    
    const costs = client.costs

    const execCosts = await costs.getExecutionCosts(executionId);
    //console.log(`${JSON.stringify(execCosts,null,2)}`)
    
    const eplanCosts = execCosts.planning?.totalCostUsd
    const eCosts = execCosts.execution?.totalCostUsd
    const eTokens = execCosts.execution?.totalUsage?.totalTokens
    const subSteps = execCosts.execution?.subSteps

    console.log(`Execution plan costs: ${eplanCosts}`)
    console.log(`Execution costs: ${eCosts}`)
    console.log(`Execution tokens: ${eTokens}`)
    console.log(`Execution substeps: `)

    for (const step of subSteps) {
      if (step.toolOrPromptName == "inference") {
      console.log(`  Step: ${step.taskId} - ${step.toolOrPromptName} - Rs ${(parseFloat(step.costUsd)*92).toFixed(2)} - Tokens: ${step.usage?.totalTokens}`)
      } else {
      console.log(`  Step: ${step.taskId} - ${step.toolOrPromptName} `)

      }
    }

    
    
    
    const dagId = "dag_t8i_UQCULekxxx26mIHLF";
    const dagCosts = await costs.getDagCosts(dagId);
    //console.log(`Dag id : ${dagId} : ${JSON.stringify(dagCosts,null,2)}`)   
    
    // default group is by day
    let summary = await costs.getCostSummary({groupBy:"week"});
    //console.log(`Cost summary (group by week): ${JSON.stringify(summary,null,2)}`)

    summary = await costs.getCostSummary({groupBy:"month"});
    //console.log(`Cost summary (group by month): ${JSON.stringify(summary,null,2)}`) 

} catch(error) {
  console.error('Error reporting costs:', error);
} finally {
    await client.shutdown();
  }




}

main();
