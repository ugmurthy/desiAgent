/**
 * Example: Activate or deactivate a scheduled DAG
 *
 * Usage:
 *   bun run examples/toggle-dag-schedule.ts <dagId> activate
 *   bun run examples/toggle-dag-schedule.ts <dagId> deactivate
 *   bun run examples/toggle-dag-schedule.ts <dagId> status
 */

import { setupDesiAgent } from '../src/index.js';

type ScheduleAction = 'activate' | 'deactivate' | 'status';

const usage = `Usage: bun run examples/toggle-dag-schedule.ts <dagId> <action>

Arguments:
  dagId     The DAG ID to update
  action    activate | deactivate | status

Examples:
  bun run examples/toggle-dag-schedule.ts dag_abc123 activate
  bun run examples/toggle-dag-schedule.ts dag_abc123 deactivate
  bun run examples/toggle-dag-schedule.ts dag_abc123 status
`;

function parseAction(value: string | undefined): ScheduleAction | null {
  if (value === 'activate' || value === 'deactivate' || value === 'status') {
    return value;
  }

  return null;
}

async function main(dagId: string, action: ScheduleAction) {
  const client = await setupDesiAgent({
    llmProvider: 'openrouter',
    openrouterApiKey: process.env.OPENROUTER_API_KEY,
    modelName: process.env.LLM_MODEL || 'openai/gpt-4o',
    logLevel: process.env.LOG_LEVEL,
    databasePath: process.env.DATABASE_PATH,
  });

  try {
    if (action === 'status') {
      const dag = await client.dags.get(dagId);

      console.log(`DAG: ${dag.id}`);
      console.log(`Title: ${dag.dagTitle || '(untitled)'}`);
      console.log(`Schedule: ${dag.metadata?.cronSchedule || '(none)'}`);
      console.log(`Active: ${Boolean(dag.metadata?.scheduleActive)}`);
      console.log(`Timezone: ${dag.metadata?.timezone || 'UTC'}`);
      return;
    }

    const dag = action === 'activate'
      ? await client.dags.activateSchedule(dagId)
      : await client.dags.deactivateSchedule(dagId);

    console.log(`${action === 'activate' ? 'Activated' : 'Deactivated'} schedule for DAG ${dag.id}`);
    console.log(`Title: ${dag.dagTitle || '(untitled)'}`);
    console.log(`Schedule: ${dag.metadata?.cronSchedule || '(none)'}`);
    console.log(`Active: ${Boolean(dag.metadata?.scheduleActive)}`);
    console.log(`Timezone: ${dag.metadata?.timezone || 'UTC'}`);
  } catch (error) {
    console.error('Error toggling DAG schedule:', error);
    process.exitCode = 1;
  } finally {
    await client.shutdown();
  }
}

const dagId = process.argv[2];
const action = parseAction(process.argv[3]);

if (!dagId || process.argv[2] === '-h' || process.argv[2] === '--help') {
  console.log(usage);
  process.exit(dagId ? 0 : 1);
}

if (!action) {
  console.error('Error: action must be one of activate, deactivate, or status\n');
  console.error(usage);
  process.exit(1);
}

await main(dagId, action);
