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
    logLevel: 'warn',
  });


  try {
    const executionId= "exec_luOPXarefgapZ_FBFwfTD";
    
    const costs = client.costs

    const execCosts = await costs.getExecutionCosts(executionId);
    console.log(`Execution id : ${executionId} : ${JSON.stringify(execCosts,null,2)}`)
    
    const dagId = "dag__nkhJVnWlwD29WxR2eMRZ";
    const dagCosts = await costs.getDagCosts(dagId);
    console.log(`Dag id : ${dagId} : ${JSON.stringify(dagCosts,null,2)}`)   
    
    // default group is by day
    let summary = await costs.getCostSummary({groupBy:"week"});
    console.log(`Cost summary (group by week): ${JSON.stringify(summary,null,2)}`)

    summary = await costs.getCostSummary({groupBy:"month"});
    console.log(`Cost summary (group by month): ${JSON.stringify(summary,null,2)}`) 


    const artifacts = client.artifacts;
    console.log(`artifacts : ${Object.keys(artifacts)}`);
} catch(error) {
  console.error('Error reporting costs:', error);
}


  try {
    // List all tools
    
    const allTools = await client.tools.list();
    console.log(`Listing ${allTools.length} Tools...\n`);

   // console.log(JSON.stringify(allTools,null,2) );
  } catch (error) {
    console.error('Error listing tools:', error);
  } finally {
    await client.shutdown();
  }




}

main();
