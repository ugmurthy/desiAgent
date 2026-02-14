# desiAgent

A library-first async agent system for building autonomous workflows with TypeScript.

## Features

- **Multiple LLM Providers**: OpenAI, OpenRouter, and Ollama support
- **Autonomous Execution**: Let agents execute objectives autonomously
- **DAG Workflows**: Decompose complex objectives into directed acyclic graphs
- **Built-in Tools**: Web scraping, file operations, bash commands, and more
- **Event Streaming**: Track execution progress in real-time
- **SQLite Storage**: Persistent storage using bun:sqlite

## Installation

### Prerequisites

- [Bun](https://bun.sh) 1.3.5 or higher

### Install

```bash
bun add desiagent
```

Or with npm/pnpm:

```bash
npm install desiagent
# or
pnpm add desiagent
```

## Environment Variables

Create a `.env` file in your project root with the appropriate API keys for your chosen provider:

### OpenAI

```bash
OPENAI_API_KEY=sk-...
```

### OpenRouter

```bash
OPENROUTER_API_KEY=sk-or-...
```

### Ollama (Local)

```bash
OLLAMA_BASE_URL=http://localhost:11434  # Optional, this is the default
```

## Quick Start

### Basic Example (OpenAI)

```typescript
import { setupDesiAgent } from 'desiagent';

const client = await setupDesiAgent({
  llmProvider: 'openai',
  openaiApiKey: process.env.OPENAI_API_KEY,
  modelName: 'gpt-4o',
});

// Create and execute a DAG
const execution = await client.dags.createAndExecute('Summarize the latest tech news');
console.log(`Execution: ${execution.id}, Status: ${execution.status}`);

await client.shutdown();
```

### Using OpenRouter

```typescript
import { setupDesiAgent } from 'desiagent';

const client = await setupDesiAgent({
  llmProvider: 'openrouter',
  openrouterApiKey: process.env.OPENROUTER_API_KEY,
  modelName: 'google/gemini-2.5-flash-lite-preview-06-2025',
});

const execution = await client.dags.createAndExecute('Research best practices for API design');
await client.shutdown();
```

### Using Ollama (Local LLM)

```typescript
import { setupDesiAgent } from 'desiagent';

const client = await setupDesiAgent({
  llmProvider: 'ollama',
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
  modelName: 'llama3.2',
});

const execution = await client.dags.createAndExecute('Explain quantum computing in simple terms');
await client.shutdown();
```

## Configuration Options

```typescript
interface DesiAgentConfig {
  // LLM Provider (required)
  llmProvider: 'openai' | 'openrouter' | 'ollama';
  modelName: string;

  // Provider-specific API keys
  openaiApiKey?: string;      // Required for 'openai' provider
  openrouterApiKey?: string;  // Required for 'openrouter' provider
  ollamaBaseUrl?: string;     // Optional for 'ollama', defaults to http://localhost:11434

  // Database (optional)
  databasePath?: string;      // Default: ~/.desiAgent/data/agent.db

  // Agent definitions (optional)
  agentDefinitionsPath?: string;  // Default: ~/.desiAgent/agents

  // Logging (optional)
  logLevel?: 'debug' | 'info' | 'warn' | 'error';  // Default: 'info'

  // Callbacks (optional)
  onExecutionStart?: (executionId: string) => void;
  onExecutionEnd?: (executionId: string, result: any) => void;
}
```

## API Reference

### Agents

```typescript
// Create a new agent
const agent = await client.agents.create(name, version, prompt, params?);

// List all agents
const agents = await client.agents.list(filter?);

// Get a specific agent
const agent = await client.agents.get(id);

// Update an agent
await client.agents.update(id, updates);

// Activate/Delete an agent
await client.agents.activate(id);
await client.agents.delete(id);

// Resolve agent by name
const agent = await client.agents.resolve(name);
```

### DAGs (Directed Acyclic Graphs)

```typescript
// Create a DAG from an objective
const dag = await client.dags.create(objective, params?);

// Create and immediately execute
const execution = await client.dags.createAndExecute(objective, params?);

// Execute an existing DAG
const execution = await client.dags.execute(dagId, params?);

// List DAGs
const dags = await client.dags.list(filter?);
const scheduled = await client.dags.listScheduled();

// Get/Update/Delete
const dag = await client.dags.get(id);
await client.dags.update(id, updates);
await client.dags.delete(id);

// Resume a paused execution
await client.dags.resume(executionId);
```

### Executions

```typescript
// List executions
const executions = await client.executions.list(filter?);

// Get execution details
const execution = await client.executions.get(id);
const subSteps = await client.executions.getSubSteps(id);

// Delete an execution
await client.executions.delete(id);

// Stream execution events (AsyncIterable)
for await (const event of client.executions.streamEvents(id)) {
  console.log(event.type, event.data);
}
```

## CLI

The `desi` CLI ships with the standalone `desiCLI` package. Command groups support default subcommands for convenience:

```bash
# Artifacts
desi artifacts              # Same as: desi artifacts list
desi artifacts report.json  # Same as: desi artifacts get report.json

# Agents
desi agents                 # Same as: desi agents list

# Results
desi results exec_123       # Same as: desi results view exec_123
```

## Examples

### News Bulletin Generator

See [`examples/news-bulletin.ts`](./examples/news-bulletin.ts) for a complete example that creates a news bulletin with multiple categories.

```bash
# Run with Ollama
bun run examples/news-bulletin.ts

# Run with OpenRouter
OPENROUTER_API_KEY=your-key bun run examples/news-bulletin-openrouter.ts
```

## Manual Abort Tests

Use these scripts to manually verify that abort signals cancel in-flight LLM calls.

```bash
# OpenRouter abort test
OPENROUTER_API_KEY=sk-or-... ABORT_AFTER_MS=2000 bun run test:abort:openrouter

# Ollama abort test
OLLAMA_BASE_URL=http://localhost:11434 OLLAMA_MODEL=mistral ABORT_AFTER_MS=2000 bun run test:abort:ollama
```

## Development

### Setup

```bash
# Install dependencies
pnpm install

# Run in development mode
bun run dev
```

### Commands

```bash
# Build
pnpm build

# Type check
pnpm type-check

# Run tests
pnpm test
pnpm test:watch
pnpm test:coverage

# Database commands
pnpm db:generate
pnpm db:push
pnpm db:studio
```

## License

MIT
