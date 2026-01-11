# desiAgent

A library-first async agent system for building autonomous workflows with TypeScript.

## Features

- **Multiple LLM Providers**: OpenAI, OpenRouter, and Ollama support
- **Goal-Oriented Execution**: Create goals and let agents execute them autonomously
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

// Create a goal
const goal = await client.goals.create('Summarize the latest tech news');

// Execute the goal
const run = await client.goals.run(goal.id);
console.log(`Run started: ${run.id}, Status: ${run.status}`);

// Clean up
await client.shutdown();
```

### Using OpenRouter

```typescript
import { setupDesiAgent } from 'desiagent';

const client = await setupDesiAgent({
  llmProvider: 'openrouter',
  openrouterApiKey: process.env.OPENROUTER_API_KEY,
  modelName: 'google/gemini-2.5-flash-lite-preview-06-2025',
  logLevel: 'info',
});

const goal = await client.goals.create('Research best practices for API design', {
  title: 'API Design Research',
  stepBudget: 10,
});

const run = await client.goals.run(goal.id);
await client.shutdown();
```

### Using Ollama (Local LLM)

```typescript
import { setupDesiAgent } from 'desiagent';

const client = await setupDesiAgent({
  llmProvider: 'ollama',
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
  modelName: 'llama3.2',
  logLevel: 'info',
});

const goal = await client.goals.create('Explain quantum computing in simple terms');
const run = await client.goals.run(goal.id);

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

### Goals

```typescript
// Create a new goal
const goal = await client.goals.create(objective, params?);

// List all goals
const goals = await client.goals.list(filter?);

// Get a specific goal
const goal = await client.goals.get(id);

// Update a goal
await client.goals.update(id, updates);

// Delete a goal
await client.goals.delete(id);

// Execute a goal
const run = await client.goals.run(id);

// Pause/Resume execution
await client.goals.pause(id);
await client.goals.resume(id);
```

### Runs

```typescript
// List all runs
const runs = await client.runs.list(filter?);

// Get a specific run
const run = await client.runs.get(id);

// Get execution steps for a run
const steps = await client.runs.getSteps(id);

// Delete a run
await client.runs.delete(id);
```

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

## Examples

### News Bulletin Generator

See [`examples/news-bulletin.ts`](./examples/news-bulletin.ts) for a complete example that creates a news bulletin with multiple categories.

```bash
# Run with Ollama
bun run examples/news-bulletin.ts

# Run with OpenRouter
OPENROUTER_API_KEY=your-key bun run examples/news-bulletin-openrouter.ts
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
