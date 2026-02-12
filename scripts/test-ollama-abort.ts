import { OllamaProvider } from '../src/core/providers/ollama.js';
import type { Message } from '../src/core/providers/types.js';

const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const model = process.env.OLLAMA_MODEL || 'mistral';

const provider = new OllamaProvider(baseUrl, model);
const abortController = new AbortController();

const messages: Message[] = [
  {
    role: 'system',
    content: 'You are a helpful assistant that writes long, detailed outputs.',
  },
  {
    role: 'user',
    content: 'Write a detailed, multi-section report about global supply chains. Make it very long.',
  },
];

const abortAfterMs = Number(process.env.ABORT_AFTER_MS || 2000);

const timeoutId = setTimeout(() => {
  console.log(`Aborting Ollama call after ${abortAfterMs}ms...`);
  abortController.abort();
}, abortAfterMs);

const startedAt = Date.now();

try {
  console.log(`Starting Ollama chat with model ${model} at ${baseUrl}...`);
  const response = await provider.chat({
    messages,
    temperature: 0.7,
    abortSignal: abortController.signal,
  });

  clearTimeout(timeoutId);
  console.log('Ollama response received (unexpected if abort worked).');
  console.log('Content length:', response.content.length);
} catch (error) {
  clearTimeout(timeoutId);
  const elapsed = Date.now() - startedAt;
  console.error(`Ollama call aborted/failed after ${elapsed}ms.`);
  console.error(error instanceof Error ? error.message : String(error));
}
