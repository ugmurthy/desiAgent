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
- **Skills** — Drop a `SKILL.md` file into your workspace or global config and the agent discovers it automatically. Skills can be injected as context into LLM prompts or executed as sub-tasks in a DAG.
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
  agentName: 'DecomposerV9',
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
  agentName: 'DecomposerV9',
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

## Skills

Skills are reusable instruction files (`SKILL.md`) that extend what the agent can do. Each skill is a Markdown file with YAML frontmatter describing its name, description, and type. When a goal is submitted, desiAgent automatically discovers skills, detects which ones are relevant, and either injects their content into the LLM prompt or executes them as sub-tasks inside a DAG.

### Skill Types

| Type | Behaviour |
|---|---|
| `context` | The skill's Markdown body is loaded and injected as instructions into an LLM inference call during DAG execution. |
| `executable` | A sibling `handler.ts` file is imported and its default export is called with the task parameters. |

### SKILL.md Format

```markdown
---
name: my-skill
description: A short sentence describing what this skill does (min 10 chars).
type: context        # or "executable"
model: openai/gpt-4o # optional — override model for this skill
provider: openrouter  # optional — override provider
---

Your skill instructions in Markdown go here.
The agent receives this content when the skill is used.
```

> The `name` field **must** match the enclosing directory name (e.g., `my-skill/SKILL.md` must have `name: my-skill`).

### Discovery

On startup, `SkillRegistry.discover()` scans the following locations **in order**. The first skill registered for a given name wins — later duplicates are silently skipped.

| Priority | Location | Scope |
|---|---|---|
| 1 | `<workspace>/.agents/skills/<name>/SKILL.md` | Local (workspace) |
| 2 | `<workspace>/skills/<name>/SKILL.md` | Local (workspace) |
| 3 | `<workspace>/SKILL.md` | Local (workspace root) |
| 4 | `~/.config/agents/skills/<name>/SKILL.md` | Global |
| 5 | `~/.desiAgent/skills/<name>/SKILL.md` | Global |

**Local wins over global.** If a workspace defines a skill named `summarizer` in `.agents/skills/summarizer/SKILL.md` and a global skill with the same name exists in `~/.desiAgent/skills/summarizer/SKILL.md`, the workspace version is used.

### How Skills Are Selected

When you submit a goal, a `MinimalSkillDetector` checks for:

1. **Explicit triggers** — phrases like `use skill <name>` or `use <name> skill` in the goal text.
2. **Keyword matching** — if no explicit trigger is found, skill descriptions are matched against keywords in the goal.

Matched skills are listed in the agent's system prompt so the LLM can plan DAG tasks with `action_type: 'skill'`.

### Using Skills Programmatically

```typescript
import { SkillRegistry } from '@ugm/desiagent';

const registry = new SkillRegistry(process.cwd());
await registry.discover();

// List all discovered skills
for (const skill of registry.getAll()) {
  console.log(`${skill.name} (${skill.type}) — ${skill.description}`);
}

// Load a skill's content
const content = await registry.loadContent('my-skill');
console.log(content);
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

  // Workspace root for skill discovery
  workspaceRoot?: string;         // default: process.cwd()

  // Feature flags
  autoStartScheduler?: boolean;  // default: true
  enableToolValidation?: boolean; // default: true
  skipGenerationStats?: boolean; // default: false
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
