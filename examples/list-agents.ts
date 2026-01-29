/**
 * Example: List all Agents

 * Run with: bun run examples/list-agents.ts
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
    databasePath: process.env.DATABASE_PATH
  });


 
try {
    //list agents
    const allAgents = await client.agents.list();
    console.log(`Listing ${allAgents.length} Agents...\n`);
    //console.log(JSON.stringify(allAgents,null,2) );

    allAgents.map((agent=>{
        const {name, description,model, provider} = agent;
        console.log(`Agent: ${name} (${provider}/${model}) - ${description}`);
    }))
    
} catch (error) {
    console.error('Error listing agents:', error);             
}


}

main();
