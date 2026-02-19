# desiAgent

A library-first async agent system for building autonomous workflows with TypeScript. Give it a goal in plain English and it decomposes it into a DAG of tasks, executes them with built-in tools, and streams results back — all in a few lines of code.

## Features

- **Goal → DAG → Execution** — Describe what you want; desiAgent plans a directed acyclic graph (DAG) of sub-tasks and executes them autonomously.
- **Multiple LLM Providers** — OpenAI, OpenRouter, and Ollama (local) out of the box.
- **Built-in Tools** — Web scraping, file I/O, bash commands, email (SMTP/IMAP), PDF parsing, and more.
- **Event Streaming** — `for await` over execution events to track progress in real-time.
- **Clarification Flow** — If the goal is ambiguous the agent asks for clarification before proceeding.
- **In-Memory or Persistent Storage** — Use `:memory:` for quick experiments or a SQLite file for production.
- **Cron Scheduling** — Schedule DAGs to run on a cron expression with timezone support.
- **Artifacts** — Tools can write output files (reports, code, images) that are automatically stored and retrievable.
- **Cost Tracking** — Token usage and USD cost are recorded per execution step.
- **Experiments API** — Compare models and temperatures on the same goal in one call.

## Installation

### Prerequisites

- [Bun](https://bun.sh) ≥ 1.3.5

### Install

```bash
bun add @ugm/desiagent
```

Or with npm / pnpm:

```bash
npm install @ugm/desiagent
# or
pnpm add @ugm/desiagent
```

### Environment Variables

Create a `.env` file with your provider's API key:

```bash
# OpenRouter (recommended — access to many models via one key)
OPENROUTER_API_KEY=sk-or-...

# OpenAI
OPENAI_API_KEY=sk-...

# Ollama (local, no key needed)
OLLAMA_BASE_URL=http://localhost:11434   # optional, this is the default
```

## Examples

> All examples below use OpenRouter and an in-memory database (`:memory:`) so you can run them without any local SQLite file.

### 1. Goal → Execute in One Call

The fastest way to go from idea to result. `createAndExecuteFromGoal` plans the DAG **and** executes it in a single call.

```typescript
import { setupDesiAgent } from '@ugm/desiagent';

const client = await setupDesiAgent({
  llmProvider: 'openrouter',
  openrouterApiKey: process.env.OPENROUTER_API_KEY,
  modelName: 'google/gemini-2.5-flash-lite-preview-09-2025',
  databasePath: ':memory:',
  skipGenerationStats: true,
});

const result = await client.dags.createAndExecuteFromGoal({
  goalText: 'Research the top 5 trends in AI agents for 2025 and write a concise briefing document to ai-trends.md',
  agentName: 'DecomposerV8',
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
```

### 2. Plan First, Execute Later

Separate planning from execution so you can inspect or modify the DAG before running it.

```typescript
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

// Step 2 — Execute
const execution = await client.dags.execute(plan.dagId);
console.log('Execution ID:', execution.id);

for await (const event of client.executions.streamEvents(execution.id)) {
  console.log(event.type, event.data);
}

const details = await client.executions.getWithSubSteps(execution.id);
console.log('Final result:\n', details.finalResult);

await client.shutdown();
```

### 3. List Agents and Tools

Explore what's available in the system.

```typescript
import { setupDesiAgent } from '@ugm/desiagent';

const client = await setupDesiAgent({
  llmProvider: 'openrouter',
  openrouterApiKey: process.env.OPENROUTER_API_KEY,
  modelName: 'openai/gpt-4o',
  databasePath: ':memory:',
  skipGenerationStats: true,
  logLevel: 'warn',
});

// List seeded agents
const agents = await client.agents.list();
for (const a of agents) {
  console.log(`${a.name} (${a.provider}/${a.model}) — ${a.description}`);
}

// List available tools
const tools = await client.tools.list();
for (const t of tools) {
  console.log(t.function.name);
}

await client.shutdown();
```

### 4. Handle Clarifications

When the agent decides the goal is ambiguous, it returns a clarification query instead of creating a DAG.

```typescript
import { setupDesiAgent } from '@ugm/desiagent';

const client = await setupDesiAgent({
  llmProvider: 'openrouter',
  openrouterApiKey: process.env.OPENROUTER_API_KEY,
  modelName: 'google/gemini-2.5-flash-lite-preview-09-2025',
  databasePath: ':memory:',
  skipGenerationStats: true,
});

const plan = await client.dags.createFromGoal({
  goalText: 'Build the app',
  agentName: 'DecomposerV8',
});

if (plan.status === 'clarification_required') {
  console.log('Agent asks:', plan.clarificationQuery);

  // Provide the answer and retry
  const resumed = await client.dags.resumeFromClarification(
    plan.dagId,
    'A Pomodoro timer web app using HTML, CSS, and vanilla JS',
  );
  console.log('Resumed status:', resumed.status);
}

await client.shutdown();
```

### 5. Custom Inference (No DAG)

Use a named agent directly for a single LLM call — useful for summarisation, translation, or any one-shot task.

```typescript
import { setupDesiAgent } from '@ugm/desiagent';

const client = await setupDesiAgent({
  llmProvider: 'openrouter',
  openrouterApiKey: process.env.OPENROUTER_API_KEY,
  modelName: 'openai/gpt-4o',
  databasePath: ':memory:',
  skipGenerationStats: true,
});

// Resolve an agent by name and call it directly
const agent = await client.agents.resolve('Summarizer');
// ... or use the lower-level inference API in scripts/infer.ts

await client.shutdown();
```

### Running the Bundled Examples

The [`examples/`](./examples/) directory contains runnable scripts:

```bash
# Execute a goal from a file
bun run examples/execute-goal.ts -f examples/goals/pomodoro-timer.txt

# In-memory database smoke test
bun run examples/init_6_memory_db.ts

# List all agents
bun run examples/list-agents.ts

# List all tools
bun run examples/list-tools.ts --names
```

## Configuration Reference

```typescript
interface DesiAgentConfig {
  llmProvider: 'openai' | 'openrouter' | 'ollama';
  modelName: string;

  // Provider keys
  openaiApiKey?: string;
  openrouterApiKey?: string;
  ollamaBaseUrl?: string;       // default: http://localhost:11434

  // Storage
  databasePath?: string;        // default: ~/.desiAgent/data/agent.db
                                 // use ':memory:' for ephemeral experiments
  artifactsDir?: string;        // default: sibling of database file

  // Agent definitions
  agentDefinitionsPath?: string; // default: ~/.desiAgent/agents

  // Logging
  logLevel?: 'debug' | 'info' | 'warn' | 'error' | 'silent';

  // Lifecycle hooks
  onExecutionStart?: (executionId: string) => void;
  onExecutionEnd?: (executionId: string, result: Record<string, any>) => void;

  // Feature flags
  autoStartScheduler?: boolean;  // default: true
  enableToolValidation?: boolean; // default: true
}
```

## Contributing

We welcome contributions of all kinds — bug fixes, new tools, documentation improvements, and feature ideas.

### Getting Started

1. **Fork & clone** the repository.

   ```bash
   git clone https://github.com/<your-username>/desiAgent.git
   cd desiAgent
   ```

2. **Install dependencies** (requires Bun ≥ 1.3.5).

   ```bash
   bun install
   ```

3. **Create a branch** for your change.

   ```bash
   git checkout -b feat/my-awesome-feature
   ```

4. **Make your changes**, then verify:

   ```bash
   bun run type-check   # TypeScript must compile cleanly
   bun test             # All tests must pass
   ```

### Code Guidelines

- **TypeScript only** — no plain JS files.
- **Follow existing patterns** — look at neighbouring files before writing new code. Match naming conventions, imports, and error handling style.
- **Keep PRs focused** — one logical change per pull request. Small, reviewable diffs are merged faster.
- **Write tests** — if you add a feature or fix a bug, add or update a test in the corresponding `*.test.ts` file. Run `bun test` to verify.
- **No secrets** — never commit API keys, tokens, or credentials. Use environment variables and `.env` files (already in `.gitignore`).

### Commit Messages

Follow the [Conventional Commits](https://www.conventionalcommits.org/) format:

```
feat: add PDF attachment support to inference
fix: handle empty goal text in DAG creation
docs: update README examples
chore: bump drizzle-orm to 0.46
```

### Pull Request Process

1. Ensure your branch is up to date with `main`.
2. Open a PR against `main` with a clear title and description of **what** and **why**.
3. Link any related issues (e.g., `Closes #42`).
4. A maintainer will review your PR. Address feedback promptly — we aim to merge within a few days.

### Reporting Issues

- Use [GitHub Issues](https://github.com/ugmurthy/desiAgent/issues) to report bugs or request features.
- Include steps to reproduce, expected vs. actual behaviour, and your environment (OS, Bun version, provider used).

### Code of Conduct

Be respectful and constructive. We follow the [Contributor Covenant](https://www.contributor-covenant.org/) code of conduct.

## License

MIT
