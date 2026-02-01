/**
 * Example: List all Tools or retrieve a specific tool
 *
 * Run with: bun run examples/list-tools.ts
 * Options:
 *   --names           Only list tool names
 *   --tool <name>     Retrieve a specific tool by name
 */

import { setupDesiAgent } from '../src/index.js';

async function main() {
  const namesOnly = process.argv.includes('--names');
  const toolIndex = process.argv.indexOf('--tool');
  const toolName = toolIndex !== -1 ? process.argv[toolIndex + 1] : null;

  const client = await setupDesiAgent({
    llmProvider: 'openrouter',
    openrouterApiKey: process.env.OPENROUTER_API_KEY,
    modelName: 'openai/gpt-4o',
    logLevel: 'silent',
    databasePath: process.env.DATABASE_PATH
  });

  try {
    if (toolName) {
      const tool = await client.tools.get(toolName);
      if (tool) {
        console.log(JSON.stringify(tool, null, 2));
      } else {
        console.log(`Tool "${toolName}" not found.`);
      }
    } else {
      const tools = await client.tools.list();

      if (namesOnly) {
        console.log(`Listing ${tools.length} Tool Names...\n`);
        tools.forEach((tool) => {
          console.log(tool.function.name);
        });
      } else {
        console.log(JSON.stringify(tools, null, 2));
      }
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

main();
