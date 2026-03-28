/**
 * Execute an agent task
 *
 * Usage:
 *   bun run examples/agent-task.ts <agentName> <task> [-f <file1|file2|...>]
 *
 * Arguments:
 *   agentName   Name of the agent to resolve
 *   task        Task string (quote if it contains spaces)
 *
 * Switches:
 *   -f, --files <file1|file2|...>  Pipe-separated list of file paths to attach
 *   -h, --help                     Show this help message
 */

import { readFileSync } from 'fs';
import { setupDesiAgent } from '../src/index.js';

const USAGE = `
Usage:
  bun run examples/agent-task.ts <agentName> <task> [-f <file1|file2|...>]

Arguments:
  agentName   Name of the agent to resolve
  task        Task string (quote if it contains spaces)

Switches:
  -f, --files <file1|file2|...>  Pipe-separated list of file paths to attach
  -h, --help                     Show this help message
`.trim();

interface ParsedArgs {
  agentName?: string;
  task?: string;
  files?: string[];
  help?: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const result: ParsedArgs = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '-f':
      case '--files':
        result.files = args[++i]?.split('|');
        break;
      case '-h':
      case '--help':
        result.help = true;
        break;
      default:
        if (!result.agentName) {
          result.agentName = args[i];
        } else if (!result.task) {
          result.task = args[i];
        }
        break;
    }
  }

  return result;
}

async function main() {
  const { agentName, task, files, help } = parseArgs(process.argv);

  if (help) {
    console.log(USAGE);
    return;
  }

  if (!agentName || !task) {
    console.error('Error: <agentName> and <task> are required.\n');
    console.log(USAGE);
    process.exit(1);
  }

  const client = await setupDesiAgent({
    llmProvider: 'openrouter',
    openrouterApiKey: process.env.OPENROUTER_API_KEY,
    modelName: process.env.OPENROUTER_MODEL,
    logLevel: 'silent',
    databasePath: ':memory:'
  });

  try {
    console.log('Resolving agent:', agentName);
    const agent = await client.agents.resolve(agentName);
    console.log('Agent:', agent);

    const fileBuffers = files?.map(f => readFileSync(f));
    const result = await client.executeTask(agent, task, fileBuffers);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Error Executing agent-task:', error);
  } finally {
    client.shutdown();
  }
}

main();
