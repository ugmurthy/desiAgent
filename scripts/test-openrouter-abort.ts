import { OpenRouterProvider } from '../src/core/providers/openrouter.js';
import type { Message } from '../src/core/providers/types.js';

const apiKey = process.env.OPENROUTER_API_KEY;
const model = process.env.OPENROUTER_MODEL || 'gpt-4o-mini';

if (!apiKey) {
  console.error('Missing OPENROUTER_API_KEY');
  process.exit(1);
}

const provider = new OpenRouterProvider(apiKey, model);
const abortController = new AbortController();

const promptRepeat = Number(process.env.PROMPT_REPEAT || 1);
const maxTokens = Number(process.env.OPENROUTER_MAX_TOKENS || 4096);

const basePrompt =
  'Write a detailed, multi-section report about deep sea ecosystems. Make it very long.';
const repeatedPrompt = Array.from({ length: Math.max(promptRepeat, 1) }, () => basePrompt).join('\n\n');

const messages: Message[] = [
  {
    role: 'system',
    content: 'You are a helpful assistant that writes long, detailed outputs.',
  },
  {
    role: 'user',
    content: repeatedPrompt,
  },
];

const abortAfterMs = Number(process.env.ABORT_AFTER_MS || 2000);

const timeoutId = setTimeout(() => {
  const elapsed = Date.now() - startedAt;
  console.log(`Aborting OpenRouter call after ${elapsed}ms...`);
  abortController.abort();
}, abortAfterMs);

const startedAt = Date.now();

try {
  console.log(`Starting OpenRouter chat with model ${model}...`);
  const response = await provider.chat({
    messages,
    temperature: 0.7,
    maxTokens,
    abortSignal: abortController.signal,
  });

  clearTimeout(timeoutId);
  const elapsed = Date.now() - startedAt;
  console.log('OpenRouter response received.');
  console.log('Elapsed ms:', elapsed);
  console.log('Content length:', response.content.length);
  if (abortController.signal.aborted) {
    console.log('Abort fired after response completed. Try a shorter ABORT_AFTER_MS or larger PROMPT_REPEAT.');
  }
} catch (error) {
  clearTimeout(timeoutId);
  const elapsed = Date.now() - startedAt;
  console.error(`OpenRouter call aborted/failed after ${elapsed}ms.`);
  console.error(error instanceof Error ? error.message : String(error));
}
