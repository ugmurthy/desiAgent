# PRD: File-Based Skills System for desiAgent

## Introduction

Add a file-based skills system to desiAgent that discovers `SKILL.md` files from multiple locations, injects relevant skill context into the decomposer prompt, and executes skill-augmented LLM calls during DAG execution. This enables developers to package reusable, specialized knowledge and executable logic as self-contained "skills" that the agent automatically discovers and invokes when relevant to a goal.

v1 focuses on **context skills** (inject SKILL.md body as LLM system context) and **executable skills** (run a local `handler.ts` via dynamic import). This replaces hard-coded domain knowledge with a modular, extensible skill architecture.

## Goals

- Discover SKILL.md files from workspace and global locations at startup with priority-based deduplication
- Parse frontmatter metadata (name, description, type, optional model/provider) using Zod validation
- Detect relevant skills from goal text via keyword matching and explicit triggers
- Inject discovered skills list into the DecomposerV8 prompt via `{{skills}}` placeholder
- Execute context skills as LLM inference calls with SKILL.md body as system context
- Execute executable skills by dynamically importing and calling their `handler.ts`
- Support optional per-skill model/provider overrides in frontmatter
- Fail the DAG when a skill sub-task fails (marking the sub-task as failed)
- Export `SkillRegistry`, `SkillMeta`, `MinimalSkillDetector`, and `SkillDetector` from the library

## User Stories

### US-001: Install gray-matter dependency
**Description:** As a developer, I need the `gray-matter` package installed so that SKILL.md frontmatter can be parsed.

**Acceptance Criteria:**
- [ ] `gray-matter` added to `dependencies` in `package.json`
- [ ] `bun install` completes without errors
- [ ] Typecheck passes (`bun run type-check`)

---

### US-002: Create SkillRegistry with multi-location discovery
**Description:** As a developer, I want a `SkillRegistry` class in `src/core/skills/registry.ts` that discovers SKILL.md files from multiple locations so that skills are automatically found at startup.

**Acceptance Criteria:**
- [ ] `SkillMeta` interface defined with fields: `name`, `description`, `type` (`"context"` | `"executable"`), `filePath`, `source`, optional `model`, optional `provider`
- [ ] `SkillFrontmatterSchema` Zod schema validates frontmatter with: `name` (string, min 1), `description` (string, min 10), `type` (enum `"context"` | `"executable"`, default `"context"`), optional `model`, optional `provider`
- [ ] `discover()` scans these locations in priority order: `.agents/skills/*/SKILL.md`, `skills/*/SKILL.md`, root `SKILL.md`, `~/.config/agents/skills/*/SKILL.md`, `~/.desiAgent/skills/*/SKILL.md`
- [ ] First-match wins on name conflicts across locations
- [ ] Frontmatter `name` must match the directory name (warn and skip on mismatch); root `SKILL.md` is exempt
- [ ] Invalid or missing frontmatter logs a warning but does not crash discovery
- [ ] Only frontmatter is parsed during discovery — body content is loaded lazily via `loadContent(name)`
- [ ] `getAll()` returns all discovered `SkillMeta[]`
- [ ] `getByName(name)` returns a single `SkillMeta | undefined`
- [ ] `getFormattedList()` returns a formatted string listing all skills for prompt injection
- [ ] Unit tests cover: successful discovery, priority ordering, name mismatch skip, invalid frontmatter skip, lazy body loading
- [ ] Typecheck passes

---

### US-003: Create MinimalSkillDetector
**Description:** As a developer, I want a `MinimalSkillDetector` class in `src/core/skills/detector.ts` that matches goal text to relevant skills so that only applicable skills are flagged during decomposition.

**Acceptance Criteria:**
- [ ] `SkillDetector` interface defined with method `detect(goalText: string, skills: SkillMeta[]): string[]`
- [ ] `MinimalSkillDetector` implements `SkillDetector`
- [ ] Detects explicit triggers: `use skill <name>`, `--skill <name>`, `load skill <name>` (case-insensitive)
- [ ] Falls back to case-insensitive keyword matching of skill `name` and `description` words against goal text tokens
- [ ] Returns deduplicated matched skill names
- [ ] Unit tests cover: explicit trigger detection, keyword matching, deduplication, no matches case
- [ ] Typecheck passes

---

### US-004: Add `'skill'` to DAG action_type
**Description:** As a developer, I need the `action_type` enum in the DAG schema to include `'skill'` so the decomposer can produce skill-typed sub-tasks.

**Acceptance Criteria:**
- [ ] `src/types/dag.ts`: `SubTaskSchema.action_type` updated to `z.enum(['tool', 'inference', 'skill'])`
- [ ] `src/core/execution/dagExecutor.ts`: `SubTask` interface `action_type` updated to `'tool' | 'inference' | 'skill'`
- [ ] Existing tests still pass (`bun run test`)
- [ ] Typecheck passes

---

### US-005: Update DecomposerV8 prompt with skills section
**Description:** As a developer, I want the DecomposerV8 agent prompt in `seed/agents.json` to include a `{{skills}}` placeholder so the LLM knows about available skills when generating a plan.

**Acceptance Criteria:**
- [ ] DecomposerV8 `prompt_template` in `seed/agents.json` includes a new numbered section describing available skills
- [ ] Section instructs the LLM: when a sub-task aligns with a skill description, set `action_type` to `'skill'` and `tool_or_prompt.name` to the skill name
- [ ] Section states skill tasks are executed as LLM inference with skill instructions as system context
- [ ] Section states only skills from the provided `{{skills}}` list should be used
- [ ] No changes to DecomposerV7 or other agents
- [ ] Typecheck passes

---

### US-006: Wire SkillRegistry into DAGsService
**Description:** As a developer, I want `DAGsService` to accept a `SkillRegistry`, detect relevant skills during `createFromGoal()`, and replace `{{skills}}` in the system prompt so decomposition is skill-aware.

**Acceptance Criteria:**
- [ ] `DAGsServiceDeps` interface gains optional `skillRegistry?: SkillRegistry`
- [ ] `DAGsService` constructor stores `skillRegistry`
- [ ] `createFromGoal()` uses `MinimalSkillDetector` to detect skills from goal text
- [ ] Detected skill names are logged via `this.logger.info`
- [ ] `{{skills}}` placeholder in the system prompt is replaced with `skillRegistry.getFormattedList()` (or empty string if no registry)
- [ ] Existing tests still pass
- [ ] Typecheck passes

---

### US-007: Add skill execution branch in DAGExecutor
**Description:** As a developer, I want the `DAGExecutor` to handle `action_type === 'skill'` sub-tasks by loading the skill content and executing it via `LlmExecuteTool` (for context skills) or dynamic import (for executable skills), so skill-typed tasks produce results during DAG execution.

**Acceptance Criteria:**
- [ ] `DAGExecutorConfig` gains optional `skillRegistry?: SkillRegistry`
- [ ] When `action_type === 'skill'` and `type === 'context'`: loads SKILL.md body via `skillRegistry.loadContent()`, builds an inference prompt, resolves provider/model from skill frontmatter (falling back to inference agent), and calls `LlmExecuteTool.execute()` with skill body as the `task` (system context)
- [ ] When `action_type === 'skill'` and `type === 'executable'`: dynamically imports `handler.ts` from the skill directory and invokes the default or named `handler` export with `tool_or_prompt.params`
- [ ] If `skillRegistry` is not configured but a skill task is encountered, throws an error with message `Skill "<name>" requested but no SkillRegistry configured`
- [ ] If the named skill is not found, throws an error with message `Skill not found: <name>`
- [ ] If an executable skill is missing `handler.ts`, throws an error with message `Skill "<name>" is not executable or missing handler`
- [ ] On any skill execution failure, the sub-task is marked as `failed` and the DAG execution fails
- [ ] Result includes `content`, `usage`, `costUsd`, and `generationStats` fields
- [ ] Typecheck passes

---

### US-008: Add `workspaceRoot` to config
**Description:** As a developer, I want an optional `workspaceRoot` field in `DesiAgentConfig` and `ResolvedConfig` so that skill discovery can locate workspace-relative skill directories.

**Acceptance Criteria:**
- [ ] `DesiAgentConfig` interface in `src/types/config.ts` gains optional `workspaceRoot?: string`
- [ ] `DesiAgentConfigSchema` Zod schema includes `workspaceRoot` with default `process.cwd()`
- [ ] `ResolvedConfig` includes `workspaceRoot: string`
- [ ] `resolveConfig()` resolves `workspaceRoot` into the frozen config object
- [ ] Typecheck passes

---

### US-009: Initialize SkillRegistry in setupDesiAgent
**Description:** As a developer, I want `setupDesiAgent()` to create a `SkillRegistry`, run discovery, and pass it to `DAGsService` and `DAGExecutor` so skills are available at runtime.

**Acceptance Criteria:**
- [ ] `setupDesiAgent()` in `src/index.ts` creates a `SkillRegistry` with `resolved.workspaceRoot`
- [ ] Calls `skillRegistry.discover()` and logs the count of discovered skills
- [ ] Passes `skillRegistry` to `DAGsService` constructor deps
- [ ] `DAGsService` passes `skillRegistry` through to `DAGExecutor` when creating executors
- [ ] Typecheck passes

---

### US-010: Export skill types from library
**Description:** As a developer consuming desiAgent as a library, I want `SkillRegistry`, `SkillMeta`, `MinimalSkillDetector`, and `SkillDetector` exported from the package entry point.

**Acceptance Criteria:**
- [ ] `src/index.ts` exports `SkillRegistry` and `type SkillMeta` from `./core/skills/registry.js`
- [ ] `src/index.ts` exports `MinimalSkillDetector` and `type SkillDetector` from `./core/skills/detector.js`
- [ ] Exports are accessible after `bun run build`
- [ ] Typecheck passes

---

### US-011: Unit tests for SkillRegistry
**Description:** As a developer, I want comprehensive unit tests for `SkillRegistry` to verify discovery, priority, validation, and lazy loading behavior.

**Acceptance Criteria:**
- [ ] Test file at `src/__tests__/skills/registry.test.ts`
- [ ] Tests use a temp directory with mock SKILL.md files
- [ ] Test: discovers skills from `.agents/skills/` subdirectories
- [ ] Test: higher-priority location wins on name conflict
- [ ] Test: skips skills with name/directory mismatch (logs warning)
- [ ] Test: skips skills with invalid/missing frontmatter (logs warning, no crash)
- [ ] Test: `loadContent()` returns the markdown body (not frontmatter)
- [ ] Test: `getFormattedList()` returns formatted string with all skills
- [ ] Test: `getByName()` returns correct skill or undefined
- [ ] All tests pass (`bun run test`)

---

### US-012: Unit tests for MinimalSkillDetector
**Description:** As a developer, I want unit tests for `MinimalSkillDetector` to verify explicit trigger parsing and keyword matching.

**Acceptance Criteria:**
- [ ] Test file at `src/__tests__/skills/detector.test.ts`
- [ ] Test: `use skill cataloging-apis` returns `['cataloging-apis']`
- [ ] Test: `--skill cataloging-apis` returns `['cataloging-apis']`
- [ ] Test: `load skill cataloging-apis` returns `['cataloging-apis']`
- [ ] Test: goal text containing skill description keywords returns matching skill names
- [ ] Test: unrelated goal text returns empty array
- [ ] Test: duplicate matches are deduplicated
- [ ] Test: matching is case-insensitive
- [ ] All tests pass (`bun run test`)

---

### US-013: Integration test — end-to-end skill execution
**Description:** As a developer, I want an integration test that verifies a skill sub-task flows from discovery through detection, decomposition, and execution.

**Acceptance Criteria:**
- [ ] Test file at `src/__tests__/skills/integration.test.ts`
- [ ] Uses the existing `.agents/skills/cataloging-apis/SKILL.md` skill
- [ ] Verifies `SkillRegistry.discover()` finds `cataloging-apis`
- [ ] Verifies `MinimalSkillDetector.detect()` selects it for a relevant goal
- [ ] Verifies `getFormattedList()` includes `cataloging-apis` in output
- [ ] All tests pass (`bun run test`)

### US-014: Integration test — executable skill execution from ~/.desiAgent/skills
**Description:** As a developer, I want an integration test that verifies the `git-expert` executable skill in `~/.desiAgent/skills/git-expert/` is discovered, detected, and its `handler.ts` executes successfully.

**Acceptance Criteria:**
- [ ] Test file at `src/__tests__/skills/executable-skill.test.ts`
- [ ] `SkillRegistry.discover()` finds `git-expert` from the `~/.desiAgent/skills/` location with source `"global"`
- [ ] `git-expert` skill has `type: "executable"` (note: its frontmatter lacks an explicit `type` field — the schema should handle the missing `type` field gracefully, or the test should document that the skill needs a `type: executable` added to its frontmatter)
- [ ] `MinimalSkillDetector.detect()` selects `git-expert` for a goal like `"check git status of the repo"`
- [ ] `handler.ts` is dynamically imported via `import(\`file://\${handlerPath}\`)`
- [ ] Handler is invoked with `{ command: "status" }` and returns a string containing git status output (or a failure message)
- [ ] Handler is invoked with `{ command: "log --oneline -5" }` and returns recent commit log output
- [ ] Handler returns an error string (not a thrown exception) when given an invalid command
- [ ] All tests pass (`bun run test`)

---

## Functional Requirements

- FR-1: The system must discover SKILL.md files from 5 locations in priority order: `.agents/skills/`, `skills/`, workspace root, `~/.config/agents/skills/`, `~/.desiAgent/skills/`
- FR-2: The system must parse SKILL.md frontmatter using `gray-matter` and validate it against a Zod schema requiring `name` (min 1 char), `description` (min 10 chars), `type` (enum, default `"context"`), and optional `model`/`provider`
- FR-3: The system must enforce first-match-wins deduplication when the same skill name appears in multiple locations
- FR-4: The system must skip (with a warning log) any SKILL.md whose frontmatter `name` does not match its parent directory name
- FR-5: The system must not crash on invalid or missing frontmatter — log a warning and continue discovery
- FR-6: The system must lazily load SKILL.md body content only when `loadContent()` is called
- FR-7: The system must detect relevant skills from goal text via explicit triggers (`use skill`, `--skill`, `load skill`) and keyword matching
- FR-8: The system must inject a formatted skills list into the DecomposerV8 prompt by replacing the `{{skills}}` placeholder
- FR-9: The decomposer must be instructed to generate sub-tasks with `action_type: 'skill'` when a task aligns with an available skill
- FR-10: For context skills (`type: "context"`), the executor must call `LlmExecuteTool` with the SKILL.md body as system context and the sub-task as the user prompt
- FR-11: For executable skills (`type: "executable"`), the executor must dynamically import `handler.ts` from the skill directory and call its default or named `handler` export
- FR-12: The executor must resolve provider/model from skill frontmatter first, falling back to the inference agent's provider/model
- FR-13: When a skill sub-task fails, the sub-task must be marked as `failed` and the entire DAG execution must fail
- FR-14: The `action_type` enum in the DAG schema must include `'skill'` alongside `'tool'` and `'inference'`

## Non-Goals

- No skill content caching in memory (future TODO)
- No embedding-based or LLM-based semantic skill detection (future TODO)
- No per-agent skill scoping or allowlists (future TODO)
- No skill parameters or template variables in SKILL.md body (future TODO)
- No skill versioning or version pinning (future TODO)
- No skill composition or inter-skill dependencies (future TODO)
- No remote skill marketplace or Git-based skill fetching (future TODO)
- No sandboxing or security isolation for executable skill handlers (future TODO — developers are responsible for handler safety)
- No UI for skill management
- No changes to DecomposerV7 or other agents

## Technical Considerations

- **Runtime:** Bun (all file I/O uses `fs/promises` and `Bun.file` where appropriate)
- **Dependencies:** `gray-matter` (new), `zod` (existing), `glob` (existing), `fs/promises` (built-in)
- **Executable skills use `handler.ts`:** Dynamic import via `import(\`file://\${handlerPath}\`)`. The handler must export a default function or a named `handler` function. See `skill-guide.md` for the reference implementation pattern.
- **Existing skill:** `.agents/skills/cataloging-apis/SKILL.md` already exists in the workspace and serves as the initial test case
- **Config change:** `ResolvedConfig` gains `workspaceRoot` (defaults to `process.cwd()`), which is passed to `SkillRegistry`
- **DAGExecutor integration:** The skill branch sits alongside the existing `tool` and `inference` branches in `executeTask()`
- **Error propagation:** Skill failures throw errors that the existing DAGExecutor error handling catches, marking the sub-task as failed and failing the DAG

## Success Metrics

- `SkillRegistry.discover()` finds the existing `cataloging-apis` skill on startup
- A goal mentioning "API documentation" triggers skill detection and produces a `skill`-typed sub-task in the decomposer output
- Skill sub-tasks execute successfully via `LlmExecuteTool` with the SKILL.md body as context
- An executable skill with a `handler.ts` runs its handler and returns results
- All new unit and integration tests pass
- `bun run type-check` passes with zero errors
- No regressions in existing test suite

## Open Questions

- Should `loadContent()` cache the body in memory after first read, or always re-read from disk?
- Should executable skill handlers receive any additional context beyond `params` (e.g., workspace root, logger)?
- What is the maximum acceptable SKILL.md body size before it should be truncated for prompt injection?
- Should there be a CLI flag `--skill <name>` to force-include skills regardless of detection?
