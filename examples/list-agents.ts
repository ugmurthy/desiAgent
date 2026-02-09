/**
 * Example: List all Agents
 *
 * Usage:
 *   bun run examples/list-agents.ts                                          # list all agents
 *   bun run examples/list-agents.ts <agent-name>                             # show agent prompt
 *   bun run examples/list-agents.ts <agent-name> -u <file> [-m model] [-p provider]  # update existing agent
 *   bun run examples/list-agents.ts <agent-name> -f <file> -m <model> -p <provider>  # create new agent
 *
 * Switches:
 *   -u, --update <file>    Update an existing agent's prompt template from file
 *   -f, --file <file>      Create a new agent with prompt template from file (requires -m and -p)
 *   -m, --model <model>    Model name (optional for update, required for create)
 *   -p, --provider <name>  Provider name (optional for update, required for create)
 */

import { readFileSync } from 'fs';
import { setupDesiAgent } from '../src/index.js';

const USAGE = `
Usage:
  bun run examples/list-agents.ts                                          # list all agents
  bun run examples/list-agents.ts <agent-name>                             # show agent prompt
  bun run examples/list-agents.ts <agent-name> -u <file> [-m model] [-p provider]  # update existing agent
  bun run examples/list-agents.ts <agent-name> -f <file> -m <model> -p <provider>  # create new agent

Switches:
  -u, --update <file>    Update an existing agent's prompt template from file
  -f, --file <file>      Create a new agent with prompt template from file (requires -m and -p)
  -m, --model <model>    Model name (optional for update, required for create)
  -p, --provider <name>  Provider name (optional for update, required for create)
  -h, --help             Show this help message
`.trim();

interface ParsedArgs {
  agentName?: string;
  updateFile?: string;
  createFile?: string;
  model?: string;
  provider?: string;
  help?: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const result: ParsedArgs = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '-u':
      case '--update':
        result.updateFile = args[++i];
        break;
      case '-f':
      case '--file':
        result.createFile = args[++i];
        break;
      case '-m':
      case '--model':
        result.model = args[++i];
        break;
      case '-p':
      case '--provider':
        result.provider = args[++i];
        break;
      case '-h':
      case '--help':
        result.help = true;
        break;
      default:
        if (!result.agentName) {
          result.agentName = args[i];
        }
        break;
    }
  }

  return result;
}

async function main() {
  const client = await setupDesiAgent({
    llmProvider: 'openrouter',
    openrouterApiKey: process.env.OPENROUTER_API_KEY,
    modelName: process.env.LLM_MODEL,
    logLevel: process.env.LOG_LEVEL,
    databasePath: process.env.DATABASE_PATH
  });

  const { agentName, updateFile, createFile, model, provider, help } = parseArgs(process.argv);

  if (help) {
    console.log(USAGE);
    return;
  }

  try {
    if (agentName && createFile) {
      if (!model || !provider) {
        console.error('Error: -m <model> and -p <provider> are required when creating a new agent');
        process.exit(1);
      }
      const prompt = readFileSync(createFile, 'utf-8');
      const created = await client.agents.create(agentName, '1.0', prompt, { model, provider });
      console.log(`Created agent "${created.name}" (${provider}/${model})`);
      return;
    }

    if (agentName && updateFile) {
      const allAgents = await client.agents.list();
      const matched = allAgents.find(agent => agent.name === agentName);
      if (!matched) {
        console.error(`No agent found with name "${agentName}"`);
        process.exit(1);
      }
      const newPrompt = readFileSync(updateFile, 'utf-8');
      const updates: Record<string, any> = { systemPrompt: newPrompt };
      if (model) updates.model = model;
      if (provider) updates.provider = provider;
      const updated = await client.agents.update(matched.id, updates);
      console.log(`Updated agent "${updated.name}" from ${updateFile}`);
      return;
    }

    const allAgents = await client.agents.list();

    if (agentName) {
      const matched = allAgents.find(agent => agent.name === agentName);
      if (matched) {
        console.log(`Prompt template for "${matched.name}":\n`);
        console.log(matched.systemPrompt);
      } else {
        console.log(`No agent found with name "${agentName}"`);
      }
    } else {
      console.log(`Listing ${allAgents.length} Agents...\n`);
      allAgents.forEach(agent => {
        const { name, description, model, provider } = agent;
        console.log(`Agent: ${name} (${provider}/${model}) - ${description}`);
      });
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

main();
