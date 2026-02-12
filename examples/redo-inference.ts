/**
 * Example: Redo inference for a completed execution
 *
 * Run with: bun run examples/redo-inference.ts
 */

import { setupDesiAgent } from '../src/index.js';

async function main() {
  //const executionId = 'exec_sgJ3K1_NRw22vywekFmMk';
  const executionId = 'exec_1vHr96O3VkGHR3vRiu06t'
  const provider = 'openrouter' as const;
  const model = 'anthropic/claude-haiku-4.5';

  const client = await setupDesiAgent({
    llmProvider: (process.env.LLM_PROVIDER as 'openai' | 'openrouter' | 'ollama') || 'openrouter',
    openrouterApiKey: process.env.OPENROUTER_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL,
    modelName: process.env.LLM_MODEL || process.env.OPENROUTER_MODEL || model,
    logLevel: (process.env.LOG_LEVEL as 'info' | 'debug' | 'warn' | 'error' | 'silent') || 'info',
    databasePath: process.env.DATABASE_PATH,
  });

  try {
    console.log(`Redoing inference for execution ${executionId}`);

    const result = await client.dags.redoInference(executionId, { provider, model });
    
    console.log(`Redo inference completed: ${JSON.stringify(result, null, 2)}`);
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.shutdown();
  }
}

main();
