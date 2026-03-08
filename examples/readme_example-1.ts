import { setupDesiAgent } from '@ugm/desiagent';

const client = await setupDesiAgent({
  llmProvider: 'openrouter',
  openrouterApiKey: process.env.OPENROUTER_API_KEY,
  modelName: 'google/gemini-2.5-flash-lite-preview-09-2025',
  databasePath: ':memory:',
  skipGenerationStats: true,
});

const result = await client.dags.createAndExecuteFromGoal({
  goalText: 'Use derivative skill to find second derivative of the following vector [0,1,4,9,16,25,36,49,64,81,100,121,144]',
  agentName: 'DecomposerV9',
  temperature: 0.7,
});

if (result.status === 'clarification_required') {
  console.log('Agent needs more info:', result.clarificationQuery);
} else {
  console.log('Execution started:', result.executionId);

  // Stream events until completion
  for await (const event of client.executions.streamEvents(result.executionId)) {
    console.log(event.type, event.data);
  }

  // Retrieve final result
  const details = await client.executions.getWithSubSteps(result.executionId);
  console.log('Final result:\n', details.finalResult);
}

await client.shutdown();

