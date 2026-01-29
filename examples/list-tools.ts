/**
 * Example: List all Tools
 *
 * Run with: bun run examples/list-tools.ts
 * Options:
 *   --names    Only list tool names
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
    const tools = await client.tools.list();

    if (namesOnly) {
      console.log(`Listing ${tools.length} Tool Names...\n`);
      tools.forEach((tool) => {
        console.log(tool.function.name);
      });
    } else {
      // console.log(`Listing ${tools.length} Tools...\n`);
      // tools.forEach((tool) => {
      //   const { name, description } = tool.function;
      //   console.log(`Tool: ${name} - ${description}`);
      // });
      console.log(JSON.stringify(tools, null, 2));
    }
  } catch (error) {
    console.error('Error listing tools:', error);
  }
}

main();
