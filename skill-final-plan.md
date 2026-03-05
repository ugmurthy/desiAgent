# Skills Feature — Final Implementation Plan

## Overview

Add a file-based skills system to desiAgent that discovers `SKILL.md` files from multiple locations, injects relevant skill context into the decomposer prompt, and executes skill-augmented LLM calls during DAG execution. Context-only in v1 — no local `handler.ts` execution.

---

## Architecture

```
setupDesiAgent()
  └─ SkillRegistry.discover()        # once at startup
       ├─ .agents/skills/*/SKILL.md   # workspace (highest priority)
       ├─ skills/*/SKILL.md           # workspace root
       ├─ SKILL.md                    # workspace root single-file
       └─ ~/.config/agents/skills/*/  # global (lowest priority)

DAGsService.createFromGoal(goalText)
  ├─ MinimalSkillDetector.detect(goalText, allSkills)
  ├─ Replace {{skills}} in DecomposerV8 prompt
  └─ LLM generates plan with action_type: 'skill' sub-tasks

DAGExecutor.executeTask(task)
  └─ action_type === 'skill'
       ├─ SkillRegistry.loadContent(skillName)  # lazy load body
       ├─ Resolve preferred model from skill frontmatter (or fallback to inference agent)
       └─ LlmExecuteTool.execute({ task: skillContent, prompt: inferencePrompt })
```

---

## Step 1: Install `gray-matter`

```bash
bun add gray-matter
```

Already available: `zod`, `glob`, `fs/promises`.

---

## Step 2: Create `src/core/skills/registry.ts`

### Data Model

```typescript
export interface SkillMeta {
  name: string;
  description: string;
  type: "context"; // v1 only supports context
  filePath: string; // absolute path to SKILL.md
  source: "workspace-agents" | "workspace-skills" | "workspace-root" | "global";
  model?: string; // optional preferred model from frontmatter
  provider?: string; // optional preferred provider from frontmatter
}
```

### Frontmatter Schema (Zod)

```typescript
export const SkillFrontmatterSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(10),
  type: z.enum(["context", "executable"]).default("context"),
  model: z.string().optional(), // e.g. "google/gemini-2.5-flash-preview-09-2025"
  provider: z.string().optional(), // e.g. "openrouter"
});
```

- `type` defaults to `'context'` when missing (backward-compatible with existing `cataloging-apis` skill).
- `model` and `provider` are optional overrides for inference — when absent, falls back to the `inference` agent's model.

### Discovery Algorithm (Multi-Location, First-Match Wins)

Scan order (relative to `workspaceRoot`):

| Priority | Location                   | Pattern                           |
| -------- | -------------------------- | --------------------------------- |
| 1        | `.agents/skills/`          | Each subdirectory with `SKILL.md` |
| 2        | `skills/`                  | Each subdirectory with `SKILL.md` |
| 3        | Workspace root             | Single `SKILL.md` file            |
| 4        | `~/.config/agents/skills/` | Each subdirectory with `SKILL.md` |
| 5        | `~/.desiAgent/skills/`     | Each subdirectory with `SKILL.md` |

Rules:

- `name` in frontmatter must match the directory name (warn and skip on mismatch).
- First-match wins on name conflicts across locations.
- Invalid/missing frontmatter logs a warning but does not crash discovery.
- Only frontmatter is parsed during discovery — body content is loaded lazily.

### Class API

```typescript
export class SkillRegistry {
  constructor(workspaceRoot: string);

  async discover(): Promise<void>;
  getAll(): SkillMeta[];
  getByName(name: string): SkillMeta | undefined;
  async loadContent(name: string): Promise<string>; // lazy loads SKILL.md body
  getFormattedList(): string; // for {{skills}} replacement
}
```

`getFormattedList()` returns a concise list for prompt injection:

```
Available Skills:
- cataloging-apis: Documents SDK or backend API surfaces...
```

---

## Step 3: Create `src/core/skills/detector.ts`

### Interface

```typescript
export interface SkillDetector {
  detect(goalText: string, skills: SkillMeta[]): string[];
}
```

### MinimalSkillDetector

```typescript
export class MinimalSkillDetector implements SkillDetector {
  detect(goalText: string, skills: SkillMeta[]): string[];
}
```

Detection logic:

1. Check for explicit triggers: `use skill <name>` or `--skill <name>` or `load skill <name>` in goal text.
2. Case-insensitive keyword match of each skill's `name` and `description` words against goal text tokens.
3. Return matched skill names (deduplicated).

Drop-in replaceable — any class implementing `SkillDetector` can be swapped in later.

---

## Step 4: Update `src/types/dag.ts`

Add `'skill'` to the `action_type` enum:

```typescript
action_type: z.enum(['tool', 'inference', 'skill']),
```

Update the corresponding `SubTask` interface in `src/core/execution/dagExecutor.ts`:

```typescript
action_type: "tool" | "inference" | "skill";
```

---

## Step 5: Update DecomposerV8 Prompt in `seed/agents.json`

Add to `DecomposerV8.prompt_template`:

```
7. **Available Skills**: {{skills}}
   - When a sub-task aligns with a skill's description, set `action_type` to `'skill'` and `tool_or_prompt.name` to the skill name.
   - Skill tasks are executed as LLM inference with the skill's instructions as system context.
   - Only use skills from the provided list.
```

No changes to `DecomposerV7` or other agents.

---

## Step 6: Wire SkillRegistry into `src/core/execution/dags.ts`

### 6a. Add to `DAGsServiceDeps`

```typescript
export interface DAGsServiceDeps {
  // ... existing fields ...
  skillRegistry?: SkillRegistry;
}
```

Store in constructor: `this.skillRegistry = deps.skillRegistry`.

### 6b. Update `createFromGoal()`

After resolving the agent and before building the system prompt:

```typescript
// Detect relevant skills
let skillsPromptSection = "";
if (this.skillRegistry) {
  const detector = new MinimalSkillDetector();
  const detectedNames = detector.detect(goalText, this.skillRegistry.getAll());
  this.logger.info(
    { detectedSkills: detectedNames },
    "Skills detected for goal",
  );
  skillsPromptSection = this.skillRegistry.getFormattedList();
}

// Replace {{skills}} in system prompt
const systemPrompt = agent.systemPrompt
  .replace(/\{\{tools\}\}/g, JSON.stringify(toolDefinitions))
  .replace(/\{\{skills\}\}/g, skillsPromptSection)
  .replace(/\{\{currentDate\}\}/g, new Date().toLocaleString());
```

---

## Step 7: Add Skill Branch in `src/core/execution/dagExecutor.ts`

### 7a. Add `SkillRegistry` to `DAGExecutorConfig`

```typescript
export interface DAGExecutorConfig {
  // ... existing fields ...
  skillRegistry?: SkillRegistry;
}
```

### 7b. Add execution branch in `executeTask()`

After the existing `inference` branch:

```typescript
} else if (task.action_type === 'skill') {
  const skillName = task.tool_or_prompt.name;
  if (!this.skillRegistry) {
    throw new Error(`Skill "${skillName}" requested but no SkillRegistry configured`);
  }

  const skillMeta = this.skillRegistry.getByName(skillName);
  if (!skillMeta) {
    throw new Error(`Skill not found: ${skillName}`);
  }

  const skillContent = await this.skillRegistry.loadContent(skillName);
  const fullPrompt = this.buildInferencePrompt(task, globalContext, taskResults);

  // Determine provider/model: skill frontmatter → inference agent → default
  let provider: string;
  let model: string;

  if (skillMeta.provider && skillMeta.model) {
    provider = skillMeta.provider;
    model = skillMeta.model;
  } else {
    const inferenceAgent = agentCache.get('inference');
    if (!inferenceAgent) {
      throw new Error('No inference agent found for skill execution fallback');
    }
    provider = skillMeta.provider || inferenceAgent.provider;
    model = skillMeta.model || inferenceAgent.model;
  }

  const llmExecuteTool = new LlmExecuteTool({
    apiKey: this.apiKey,
    baseUrl: this.ollamaBaseUrl,
    skipGenerationStats: this.skipGenerationStats,
  });

  const result = await llmExecuteTool.execute({
    provider: provider as 'openai' | 'openrouter' | 'ollama',
    model,
    task: skillContent,       // SKILL.md body becomes system context
    prompt: fullPrompt,
  }, toolCtx);

  return {
    content: result.content,
    usage: result.usage,
    costUsd: result.costUsd,
    generationStats: result.generationStats,
  };
}
```

---

## Step 8: Initialize in `src/index.ts`

In `setupDesiAgent()`, after tool registry creation:

```typescript
import { SkillRegistry } from "./core/skills/registry.js";

// Initialize skill registry
const skillRegistry = new SkillRegistry(
  resolved.workspaceRoot || process.cwd(),
);
await skillRegistry.discover();
logger.info({ skillCount: skillRegistry.getAll().length }, "Skills discovered");

// Pass to DAGsService
const dagsService = new DAGsService({
  // ... existing deps ...
  skillRegistry,
});
```

### Config change

Add optional `workspaceRoot` to `DesiAgentConfig` / `ResolvedConfig` (defaults to `process.cwd()`).

---

## Step 9: Export from `src/index.ts`

```typescript
export { SkillRegistry, type SkillMeta } from "./core/skills/registry.js";
export {
  MinimalSkillDetector,
  type SkillDetector,
} from "./core/skills/detector.js";
```

---

## File Summary

| File                                | Action                                                           |
| ----------------------------------- | ---------------------------------------------------------------- |
| `package.json`                      | Add `gray-matter` dependency                                     |
| `src/core/skills/registry.ts`       | **New** — SkillRegistry class                                    |
| `src/core/skills/detector.ts`       | **New** — SkillDetector interface + MinimalSkillDetector         |
| `src/types/dag.ts`                  | Edit — add `'skill'` to `action_type` enum                       |
| `src/core/execution/dagExecutor.ts` | Edit — add `skill` branch, accept SkillRegistry in config        |
| `src/core/execution/dags.ts`        | Edit — accept SkillRegistry, replace `{{skills}}`, detect skills |
| `seed/agents.json`                  | Edit — add `{{skills}}` section to DecomposerV8                  |
| `src/index.ts`                      | Edit — initialize SkillRegistry, export types                    |
| `src/types/config.ts`               | Edit — add optional `workspaceRoot` field                        |

---

## Validation Checklist

1. Place a test skill at `.agents/skills/cataloging-apis/SKILL.md` (already exists).
2. Run a goal mentioning "API documentation".
3. Verify:
   - [ ] `SkillRegistry.discover()` finds `cataloging-apis`.
   - [ ] `MinimalSkillDetector.detect()` selects it.
   - [ ] `{{skills}}` in DecomposerV8 prompt is populated.
   - [ ] Decomposer produces a sub-task with `action_type: 'skill'`.
   - [ ] `DAGExecutor` executes it via `LlmExecuteTool` with SKILL.md body as context.
   - [ ] Result appears in execution output.

---

## Future TODOs

- **Executable skills with `handler.ts`**: Add `type: 'executable'` support with local TypeScript handler execution via dynamic `import()`. Requires sandboxing strategy and input validation.
- **Per-agent skill scopes**: Allow agents to declare which skills they can use (e.g., via agent metadata or a skill allowlist).
- **Advanced skill detection**: Replace `MinimalSkillDetector` with embedding-based semantic matching or a lightweight LLM classifier for better goal-to-skill alignment.
- **Skill content caching**: Cache loaded SKILL.md bodies in memory after first `loadContent()` call to avoid repeated file reads during execution.
- **Skill parameters for context skills**: Allow context skills to accept parameters that template into the SKILL.md body (e.g., `{{outputFormat}}`).
- **Skill versioning**: Support version fields in frontmatter and allow pinning specific skill versions.
- **User-provided skill override flags**: Allow CLI or API-level `--skill <name>` flags to force-include skills regardless of detection.
- **Skill composition**: Allow skills to reference or depend on other skills for multi-step specialized workflows.
- **Skill marketplace / remote skills**: Fetch skills from a remote registry or Git repository.
- **Observability**: Add structured logging and tracing for skill discovery, detection, and execution metrics.
