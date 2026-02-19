import { setupDesiAgent } from '@ugm/desiagent';

const client = await setupDesiAgent({
  llmProvider: 'openrouter',
  openrouterApiKey: process.env.OPENROUTER_API_KEY,
  modelName: 'google/gemini-2.5-flash-lite-preview-09-2025',
  databasePath: ':memory:',
  skipGenerationStats: true,
});

// Step 1 — Plan
const plan = await client.dags.createFromGoal({
  goalText: 'Create a tutorial on processing driftwood into handicrafts — cover cleaning, tools, finishes — and write it to driftwood.md',
  agentName: 'DecomposerV8',
  temperature: 0.7,
});

if (plan.status !== 'success') {
  console.log('Planning issue:', plan.status);
  await client.shutdown();
  process.exit(1);
}

console.log('DAG created:', plan.dagId);
console.log("Dag data:\n",JSON.stringify(plan,null,2));

// Step 2 — Execute
const execution = await client.dags.execute(plan.dagId);
console.log('Execution ID:', execution.id);

for await (const event of client.executions.streamEvents(execution.id)) {
  console.log(event.type, event.data);
}

const details = await client.executions.getWithSubSteps(execution.id);
console.log('Final result:\n', details.finalResult);

await client.shutdown();
