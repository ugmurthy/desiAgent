/**
 * Example: List all artifacts
 
 */

import { setupDesiAgent } from '../src/index.js';

async function main() {
  const namesOnly = process.argv.includes('--names');

  const client = await setupDesiAgent({
    llmProvider: 'openrouter',
    openrouterApiKey: process.env.OPENROUTER_API_KEY,
    modelName: 'openai/gpt-4o',
    logLevel: 'warn',
    databasePath: process.env.DATABASE_PATH
  });

  try {
    const artifacts = await client.artifacts.list();
    if (namesOnly) {
      console.log(`Listing ${artifacts.length} Artifact Names...\n`);
      artifacts.forEach((artifact) => {
        console.log(artifact);

        
      });
    } else  
    console.log(JSON.stringify(artifacts, null, 2));
   
  } catch (error) {
    console.error('Error listing tools:', error);
  }
}

main();
