/**
 * Example: List all artifacts
 
 */

import { setupDesiAgent } from '../src/index.js';

async function main() {
 

  const client = await setupDesiAgent({
    llmProvider: 'openrouter',
    openrouterApiKey: process.env.OPENROUTER_API_KEY,
    modelName: 'openai/gpt-4o',
    logLevel: 'warn',
    databasePath: process.env.DATABASE_PATH
  });

  client.dags.createFromGoal({scheduleActive:true,cronSchedule:"0 * * * * *",goalText:"sd sds sd",agentName:"decompoerv9"})
  try {
    const checkerAgent = await client.agents.resolve(process.env.DEFAULT_DECOMPOSER_AGENT || "DecomposerV9");
    const result = await client.executeTask(checkerAgent,"create a web app: Pomodoro time in a single html file.");
    console.log(JSON.stringify(result,null,2));
    
    
   
  } catch (error) {
    console.error('Error Executing agent-tasks:', error);
  }
}

main();
