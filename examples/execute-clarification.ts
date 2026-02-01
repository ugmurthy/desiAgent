/**
 * Example: Resume DAG execution with clarification response
 *
 * This example demonstrates how to:
 * 1. Resume a pending DAG that requires clarification
 * 2. Provide clarification via file or stdin
 *
 * Run with:
 *   bun run examples/execute-clarification.ts <dagId> -f <clarifications.txt>
 *   echo "clarification text" | bun run examples/execute-clarification.ts <dagId>
 */

import { setupDesiAgent } from '../src/index.js';

function printUsage(): void {
  console.log(`
Usage: bun run examples/execute-clarification.ts <dagId> [-f|--file <filename>]

Arguments:
  dagId                  The ID of the pending DAG to resume

Options:
  -f, --file <filename>  Read clarification text from file
                         If not provided, reads from stdin

Examples:
  bun run examples/execute-clarification.ts dag_abc123 -f clarifications.txt
  bun run examples/execute-clarification.ts dag_abc123 --file response.txt
  echo "My clarification" | bun run examples/execute-clarification.ts dag_abc123
  cat clarifications.txt | bun run examples/execute-clarification.ts dag_abc123
`);
}

function parseArgs(args: string[]): { dagId: string; filename?: string } | null {
  if (args.length < 1) {
    console.error('Error: dagId is required');
    return null;
  }

  const dagId = args[0];

  if (dagId.startsWith('-')) {
    console.error('Error: dagId must be the first argument and cannot start with "-"');
    return null;
  }

  let filename: string | undefined;

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];

    if (arg === '-f' || arg === '--file') {
      if (i + 1 >= args.length) {
        console.error(`Error: ${arg} requires a filename argument`);
        return null;
      }
      filename = args[i + 1];
      i++;
    } else if (arg.startsWith('-')) {
      console.error(`Error: Unknown option "${arg}"`);
      return null;
    } else {
      console.error(`Error: Unexpected argument "${arg}"`);
      return null;
    }
  }

  return { dagId, filename };
}

async function readClarificationsFromStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];
  const stdin = Bun.stdin.stream();
  const reader = stdin.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const combined = new Uint8Array(chunks.reduce((acc, c) => acc + c.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  return new TextDecoder().decode(combined).trim();
}

async function readClarificationsFromFile(filename: string): Promise<string> {
  const file = Bun.file(filename);
  if (!(await file.exists())) {
    throw new Error(`File not found: ${filename}`);
  }
  return (await file.text()).trim();
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('-h') || args.includes('--help')) {
    printUsage();
    process.exit(0);
  }

  const parsed = parseArgs(args);
  if (!parsed) {
    printUsage();
    process.exit(1);
  }

  const { dagId, filename } = parsed;

  let clarifications: string;
  try {
    if (filename) {
      clarifications = await readClarificationsFromFile(filename);
    } else {
      clarifications = await readClarificationsFromStdin();
    }
  } catch (error) {
    console.error(`Error reading clarifications: ${(error as Error).message}`);
    process.exit(1);
  }

  if (!clarifications) {
    console.error('Error: Clarification text is empty');
    process.exit(1);
  }

  const client = await setupDesiAgent({
    llmProvider: 'openrouter',
    openrouterApiKey: process.env.OPENROUTER_API_KEY,
    modelName: 'google/gemini-2.5-flash-lite-preview-09-2025',
    databasePath: process.env.DATABASE_PATH ,
  });

  try {
    console.log(`Resuming DAG ${dagId} with clarification...`);
    console.log(`Clarification text: "${clarifications.substring(0, 100)}${clarifications.length > 100 ? '...' : ''}"`);

    const result = await client.dags.resumeFromClarification(dagId, clarifications);

    console.log('\nResult:');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Error:', (error as Error).message);
    process.exit(1);
  } finally {
    await client.shutdown();
  }
}

main();
