# `setupDesiAgent()` Initialisation Issues

## Initialisation Flow

```
User config object
  → Zod schema validation (DesiAgentConfigSchema.parse)
  → initializeLogger(logLevel)
  → getDatabase(databasePath)
  → compute artifactsDir
  → init services (Agents, Executions, Tools, ToolExecutor)
  → createLLMProvider(…) + validateLLMSetup(…)
  → init DAGsService, ArtifactsService, CostsService
  → return DesiAgentClientImpl
```

---

## Parameter Reference

### Mandatory (no defaults)

| Parameter     | Type                                    | Notes                                                                |
| ------------- | --------------------------------------- | -------------------------------------------------------------------- |
| `llmProvider` | `'openai' \| 'openrouter' \| 'ollama'` | Must be specified; Zod rejects anything else                         |
| `modelName`   | `string`                                | Must be specified; factory has fallback defaults but they're unreachable since the schema requires this field |

### Optional with Defaults

| Parameter              | Default                                                         | Source                          |
| ---------------------- | --------------------------------------------------------------- | ------------------------------- |
| `databasePath`         | `$HOME/.desiAgent/data/agent.db`                                | Zod `.default()` using `HOME` / `USERPROFILE` env |
| `agentDefinitionsPath` | `$HOME/.desiAgent/agents`                                       | Zod `.default()` using `HOME` / `USERPROFILE` env |
| `logLevel`             | `'info'`                                                        | Zod `.default('info')`          |
| `autoStartScheduler`   | `true`                                                          | Zod `.default(true)`            |
| `enableToolValidation` | `true`                                                          | Zod `.default(true)`            |
| `artifactsDir`         | *No Zod default* — computed in `index.ts` as `resolve(dirname(databasePath), 'artifacts')` | Two-stage fallback |

### Conditionally Required (Provider-Specific)

| Parameter         | When Required               | Env Fallback                         |
| ----------------- | --------------------------- | ------------------------------------ |
| `openaiApiKey`    | `llmProvider === 'openai'`  | **None** — factory throws if missing |
| `openrouterApiKey`| `llmProvider === 'openrouter'` | `process.env.OPENROUTER_API_KEY` in factory |
| `ollamaBaseUrl`   | `llmProvider === 'ollama'`  | `http://localhost:11434` in factory  |

### Overrides & Precedence Conflicts

| Item | What Happens |
| ---- | ------------ |
| **Logger level** | Zod defaults to `'info'`. But `initializeLogger()` has its own fallback: explicit arg → `LOG_LEVEL` env → `'silent'`. Since `setupDesiAgent` always passes the Zod-validated value, the env fallback only fires if `getLogger()` is called *before* `setupDesiAgent`. |
| **`ARTIFACTS_DIR` env** | Individual tools (`writeFile`, `readFile`, `glob`, `grep`, `edit`, `sendEmail`) each read `process.env.ARTIFACTS_DIR` independently — this can disagree with the `artifactsDir` computed in `setupDesiAgent` and passed to `ToolExecutor`. |

---

## Bugs & Corner Cases

### Bug 1 — Wrong API key passed for non-OpenRouter providers

**Location:** `src/index.ts` lines 131–133

```ts
apiKey: validatedConfig.llmProvider === 'openrouter'
  ? validatedConfig.openrouterApiKey
  : validatedConfig.openaiApiKey,
```

When `llmProvider === 'ollama'`, this passes `openaiApiKey` (likely `undefined`) as `apiKey`. Harmless today because the Ollama branch ignores `apiKey`, but fragile — any change to factory logic could break it.

**Fix:** Use a proper switch/map for provider → key selection.

---

### Bug 2 — `logLevel` from env can crash Zod validation

In examples like `execute-goal.ts`:

```ts
logLevel: process.env.LOG_LEVEL   // string | undefined
```

If `LOG_LEVEL` is set to an invalid value (e.g. `"verbose"`), Zod rejects the entire config and throws `ConfigurationError`. TypeScript doesn't catch this because `process.env.LOG_LEVEL` is `string | undefined` — compatible with the optional parameter.

**Fix:** Either validate/sanitise env-sourced `logLevel` before passing, or use `.catch('info')` in the Zod schema to fall back instead of reject.

---

### Bug 3 — `ProcessedDesiAgentConfig.artifactsDir` is declared required but Zod never sets a default

The Zod schema: `artifactsDir: z.string().optional()` — output type is `string | undefined`.  
The interface: `ProcessedDesiAgentConfig` declares it as `string` (required).  
The `as ProcessedDesiAgentConfig` cast in `validateConfig` hides this lie. The value is `undefined` in the "processed" config until `setupDesiAgent` computes it at line 115.

**Fix:** Either move the default computation into the Zod schema, or remove `artifactsDir` from `ProcessedDesiAgentConfig`'s required fields.

---

### Bug 4 — `ARTIFACTS_DIR` env can disagree with config `artifactsDir`

Tools like `writeFile.ts`, `readFile.ts`, `glob.ts` each independently read `process.env.ARTIFACTS_DIR`. If a user sets `artifactsDir` in config but also has a different `ARTIFACTS_DIR` env var, the `ToolExecutor` uses the config value while the tool implementations use the env var — split-brain file operations.

**Fix:** Have tools receive `artifactsDir` from their registry/executor context rather than reading `process.env.ARTIFACTS_DIR` directly.

---

### Bug 5 — `HOME` fallback to literal `'~'`

In `config.ts` line 19:

```ts
const home = process.env.HOME || process.env.USERPROFILE || '~';
```

If neither env var is set, the path becomes `~/.desiAgent/data/agent.db`. Node/Bun path APIs do **not** expand `~` — this creates a literal directory named `~` in the current working directory.

**Fix:** Use `os.homedir()` (already used in `logger.ts`) instead of the env-var chain.

---

### Bug 6 — Empty string API keys pass validation

`openaiApiKey: z.string().optional()` accepts `""`. This passes Zod validation but the OpenAI/OpenRouter SDK fails later with a less clear error.

**Fix:** Add `.min(1)` to API key schemas, or use a Zod `.refine()` to enforce non-empty when the corresponding provider is selected.

---

### Bug 7 — Provider cache ignores API key changes

The provider cache key is `"provider:model:maxTokens"`. If `setupDesiAgent` is called twice with the same provider/model but a different API key, the cached provider from the first call is returned, silently using the old key.

**Fix:** Include a hash of the API key in the cache key, or invalidate on key change.

---

## In-Memory Database (`:memory:`) Issues

When `databasePath` is set to `':memory:'`, several things go wrong:

### Issue A — `dirname(':memory:')` resolves to `'.'` → artifacts land in CWD

`src/index.ts` line 115–116:

```ts
const artifactsDir = validatedConfig.artifactsDir
  || resolve(dirname(validatedConfig.databasePath), 'artifacts');
```

`dirname(':memory:')` returns `'.'`, so `artifactsDir` resolves to `<cwd>/artifacts`. This is technically functional but almost certainly not what the user intended — and it silently writes files into the working directory.

### Issue B — `createDatabase` tries to `mkdirSync(dirname(':memory:'))` → creates `'.'`

`src/db/client.ts` lines 102–106:

```ts
const dbDir = dirname(dbPath);           // → '.'
if (!existsSync(dbDir)) {                // '.' always exists, so this is a no-op
  mkdirSync(dbDir, { recursive: true });
}
```

This happens to be harmless (CWD always exists), but reveals that the code doesn't distinguish in-memory from file-based databases.

### Issue C — `existsSync(':memory:')` is always `false` → tables always recreated

`src/db/client.ts` line 109:

```ts
const isNewDatabase = !existsSync(dbPath);  // always true for ':memory:'
```

This triggers table creation on every call. For `:memory:` this is correct (the DB is always fresh), but the log message `"New database detected, creating tables..."` is misleading — especially since lines 119–125 run `initializeTables` in both branches anyway, making `isNewDatabase` irrelevant.

### Issue D — WAL mode is incompatible with `:memory:`

`src/db/client.ts` line 115:

```ts
sqlite.exec('PRAGMA journal_mode = WAL;');
```

SQLite silently ignores `WAL` for in-memory databases and stays in `memory` journal mode. The code doesn't check the return value, so this is a silent no-op. Not a crash, but potentially confusing when debugging performance or concurrency issues.

### Issue E — Data loss on `shutdown()` is not communicated

When using `:memory:`, calling `client.shutdown()` destroys all data with no warning. The `closeDatabase` function (line 156–169) just sets `dbInstance = null` — there's no check for in-memory mode and no warning log.

### Issue F — Global singleton + `:memory:` = stale reference on re-init

`getDatabase()` (line 146–151) caches the first `dbInstance` globally. If the caller:
1. Creates a client with `databasePath: ':memory:'`
2. Shuts it down (`dbInstance = null`)
3. Creates another client with a file-based path

...it works. But if they create two clients with *different* in-memory databases (intending isolation), they silently share the same instance.

### Summary of `:memory:` Impact

| Area | Behaviour | Severity |
| ---- | --------- | -------- |
| `artifactsDir` computation | Falls back to `<cwd>/artifacts` | Medium — silent wrong path |
| `mkdirSync` | No-op (harmless) | None |
| `isNewDatabase` | Always `true` (correct but misleading log) | Low |
| WAL pragma | Silently ignored | Low |
| Data loss on shutdown | No warning | Medium |
| Singleton cache | No isolation between multiple clients | Medium |

### Recommended Fix for `:memory:`

Add an early guard in `setupDesiAgent` or `createDatabase` that detects `:memory:` and:
1. Requires `artifactsDir` to be explicitly set (or errors out).
2. Skips `dirname`/`mkdirSync` logic.
3. Skips WAL pragma.
4. Logs a warning that data will not persist.

---

## Proposed Improvements (Summary)

| # | Fix | Files Affected |
|---|-----|----------------|
| 1 | Use switch/map for provider → API key routing | `src/index.ts` |
| 2 | Move `artifactsDir` default into Zod schema or fix `ProcessedDesiAgentConfig` type | `src/types/config.ts`, `src/index.ts` |
| 3 | Add `.min(1)` to API key Zod schemas | `src/types/config.ts` |
| 4 | Add `.refine()` for provider-key coupling (require key when provider selected) | `src/types/config.ts` |
| 5 | Have tools receive `artifactsDir` via context, not `process.env` | `src/core/tools/*.ts` |
| 6 | Replace `'~'` fallback with `os.homedir()` | `src/types/config.ts` |
| 7 | Sanitise env-sourced `logLevel` in examples / add `.catch()` to Zod | `src/types/config.ts` or examples |
| 8 | Handle `:memory:` database path explicitly | `src/db/client.ts`, `src/index.ts` |
| 9 | Include API key in provider cache key | `src/core/providers/factory.ts` |

---

## Plan: Single Source of Truth for Resolved Configuration

### Problem

Environment variables and defaults are read in **16+ locations** across the codebase. The same value (e.g. `ARTIFACTS_DIR`) is resolved independently with its own fallback chain in each consumer, creating divergence risk and making it impossible to know what value is actually in effect.

#### Current `process.env` reads across `src/`

| Env Var | Files That Read It | Fallback Used |
|---|---|---|
| `ARTIFACTS_DIR` | `core/tools/writeFile.ts`, `readFile.ts`, `glob.ts`, `grep.ts`, `edit.ts`, `bash.ts`, `sendEmail.ts`, `core/tools/executor.ts`, `core/execution/dagExecutor.ts`, `core/execution/dags.ts` | `ctx.artifactsDir \|\| process.env.ARTIFACTS_DIR \|\| './artifacts'` (repeated 8×) |
| `OPENROUTER_API_KEY` | `core/providers/factory.ts` | `config.apiKey \|\| process.env.OPENROUTER_API_KEY` |
| `HOME` / `USERPROFILE` | `types/config.ts` (2×) | `process.env.HOME \|\| process.env.USERPROFILE \|\| '~'` |
| `LOG_DEST` | `util/logger.ts` | `'console'` |
| `LOG_DIR` | `util/logger.ts` | `~/.desiAgent/logs` |
| `LOG_LEVEL` | `util/logger.ts` | `'silent'` |
| `SMTP_HOST/PORT/USER/PASS/FROM` | `core/tools/sendEmail.ts` | various (587 for port, etc.) |
| `IMAP_HOST/PORT/USER/PASS` | `core/tools/readEmail.ts` | `imap.gmail.com`, `993`, falls back to `SMTP_USER/PASS` |
| `STALE_EXECUTION_MINUTES` | `core/execution/dags.ts` | `'5'` |

### Design: `ResolvedConfig`

Introduce a **single resolution step** in `setupDesiAgent` that reads all env vars once, applies all defaults, and produces a fully-resolved, frozen config object. Every downstream consumer receives the values it needs — no consumer ever calls `process.env` or applies its own defaults.

#### 1. New type: `ResolvedConfig`

In `src/types/config.ts`, add a new interface that represents the fully-resolved configuration after all env vars and defaults have been applied:

```ts
export interface ResolvedConfig {
  // Database
  databasePath: string;
  isMemoryDb: boolean;

  // Artifacts
  artifactsDir: string;

  // LLM
  llmProvider: 'openai' | 'openrouter' | 'ollama';
  modelName: string;
  apiKey: string | undefined;  // resolved for the active provider
  ollamaBaseUrl: string;

  // Agent definitions
  agentDefinitionsPath: string;

  // Logging
  logLevel: LogLevel;
  logDest: 'console' | 'file' | 'both';
  logDir: string;

  // Email (SMTP)
  smtp: {
    host: string | undefined;
    port: number;
    user: string | undefined;
    pass: string | undefined;
    from: string | undefined;
  };

  // Email (IMAP)
  imap: {
    host: string;
    port: number;
    user: string | undefined;
    pass: string | undefined;
  };

  // Execution
  staleExecutionMinutes: number;

  // Feature flags
  autoStartScheduler: boolean;
  enableToolValidation: boolean;
}
```

#### 2. New function: `resolveConfig`

In `src/types/config.ts` (or a new `src/config/resolve.ts`), a single function that:
- Takes the Zod-validated `DesiAgentConfig` output
- Reads every env var **once**
- Applies every default **once**
- Returns a frozen `ResolvedConfig`

```ts
import { homedir } from 'os';

export function resolveConfig(validated: DesiAgentConfig): ResolvedConfig {
  const home = homedir();
  const isMemoryDb = validated.databasePath === ':memory:';
  const databasePath = validated.databasePath ?? `${home}/.desiAgent/data/agent.db`;

  // Artifacts: explicit config > env > derived from databasePath > CWD fallback for :memory:
  const artifactsDir = validated.artifactsDir
    ?? process.env.ARTIFACTS_DIR
    ?? (isMemoryDb ? resolve('./artifacts') : resolve(dirname(databasePath), 'artifacts'));

  // API key: resolve once based on provider
  let apiKey: string | undefined;
  if (validated.llmProvider === 'openai') {
    apiKey = validated.openaiApiKey;
  } else if (validated.llmProvider === 'openrouter') {
    apiKey = validated.openrouterApiKey ?? process.env.OPENROUTER_API_KEY;
  }
  // ollama: no key needed

  const ollamaBaseUrl = validated.ollamaBaseUrl ?? 'http://localhost:11434';

  // Logging
  const logLevel = validated.logLevel ?? 'info';
  const logDestRaw = process.env.LOG_DEST?.toLowerCase();
  const logDest = (logDestRaw === 'file' || logDestRaw === 'both') ? logDestRaw : 'console';
  const logDir = process.env.LOG_DIR ?? `${home}/.desiAgent/logs`;

  // SMTP
  const smtp = {
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 587,
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM,
  };

  // IMAP (falls back to SMTP credentials)
  const imap = {
    host: process.env.IMAP_HOST ?? 'imap.gmail.com',
    port: process.env.IMAP_PORT ? parseInt(process.env.IMAP_PORT, 10) : 993,
    user: process.env.IMAP_USER ?? smtp.user,
    pass: process.env.IMAP_PASS ?? smtp.pass,
  };

  // Execution tuning
  const staleExecutionMinutes = parseInt(process.env.STALE_EXECUTION_MINUTES ?? '5', 10);

  return Object.freeze({
    databasePath,
    isMemoryDb,
    artifactsDir,
    llmProvider: validated.llmProvider,
    modelName: validated.modelName,
    apiKey,
    ollamaBaseUrl,
    agentDefinitionsPath: validated.agentDefinitionsPath ?? `${home}/.desiAgent/agents`,
    logLevel,
    logDest,
    logDir,
    smtp: Object.freeze(smtp),
    imap: Object.freeze(imap),
    staleExecutionMinutes,
    autoStartScheduler: validated.autoStartScheduler ?? true,
    enableToolValidation: validated.enableToolValidation ?? true,
  });
}
```

#### 3. Thread `ResolvedConfig` through the system

The resolved config replaces every scattered `process.env` read. Each consumer receives only what it needs:

| Consumer | Currently Reads | After: Receives From |
|---|---|---|
| `initializeLogger()` | `process.env.LOG_DEST`, `LOG_DIR`, `LOG_LEVEL` | `resolved.logLevel`, `resolved.logDest`, `resolved.logDir` |
| `createLLMProvider()` | `process.env.OPENROUTER_API_KEY` | `resolved.apiKey` (already resolved for active provider) |
| `createDatabase()` | *(none, but doesn't handle `:memory:`)* | `resolved.databasePath`, `resolved.isMemoryDb` |
| `ToolExecutor` constructor | `process.env.ARTIFACTS_DIR` | `resolved.artifactsDir` (already passed, but remove env fallback) |
| `DAGsService` constructor | `process.env.ARTIFACTS_DIR` | `resolved.artifactsDir` via `deps.artifactsDir` (already passed, remove env fallback) |
| `DAGExecutor` constructor | `process.env.ARTIFACTS_DIR` | `resolved.artifactsDir` via config (remove env fallback) |
| `ToolContext.artifactsDir` | `process.env.ARTIFACTS_DIR` (8 tools) | `ctx.artifactsDir` — already set by `ToolExecutor`, remove `process.env` fallback in each tool |
| `SendEmailTool` | `process.env.SMTP_*` (5 vars) | `resolved.smtp` via `ToolContext` or constructor injection |
| `ReadEmailTool` | `process.env.IMAP_*`, `SMTP_*` (4 vars) | `resolved.imap` via `ToolContext` or constructor injection |
| `DAGsService.resumeExecution` | `process.env.STALE_EXECUTION_MINUTES` | `resolved.staleExecutionMinutes` via `deps` |

#### 4. Expand `ToolContext` to carry resolved values

The `ToolContext` interface (in `src/core/tools/base.ts`) already has an optional `artifactsDir`. Extend it to carry email config too:

```ts
export interface ToolContext {
  // ... existing fields ...
  artifactsDir: string;        // make required (not optional)
  smtp?: ResolvedConfig['smtp'];
  imap?: ResolvedConfig['imap'];
}
```

The `ToolExecutor` populates these from `ResolvedConfig` when creating the context (line 43–54 of `executor.ts`). Individual tools then use `ctx.smtp` / `ctx.imap` instead of reading `process.env`.

#### 5. Updated `setupDesiAgent` flow

```
User config object
  → Zod schema validation (DesiAgentConfigSchema.parse)
  → resolveConfig()              ← NEW: single env-var + defaults resolution
  → Object.freeze(resolved)     ← immutable from here on
  → initializeLogger(resolved.logLevel, resolved.logDest, resolved.logDir)
  → createDatabase(resolved.databasePath, resolved.isMemoryDb)
  → services init (all receive resolved values, no env reads)
  → createLLMProvider({ provider, apiKey, baseUrl, model })
  → return DesiAgentClientImpl
```

#### 6. Changes per file

| File | Change |
|---|---|
| `src/types/config.ts` | Add `ResolvedConfig` interface. Replace `HOME \|\| USERPROFILE \|\| '~'` with `os.homedir()`. `ProcessedDesiAgentConfig` can be deprecated or aliased to `ResolvedConfig`. |
| `src/index.ts` | Call `resolveConfig()` after Zod parse. Pass `resolved` to all service constructors. Remove inline `artifactsDir` computation (lines 115–116). Remove `llmProviderConfig` assembly (lines 129–136) — use `resolved.apiKey` directly. |
| `src/util/logger.ts` | `initializeLogger` accepts `logLevel`, `logDest`, `logDir` as params. Remove all `process.env` reads from `getLogDest()` and `getLogDir()`. |
| `src/core/providers/factory.ts` | Remove `process.env.OPENROUTER_API_KEY` fallback (line 63). Key is already resolved. |
| `src/core/tools/executor.ts` | Remove `process.env.ARTIFACTS_DIR` fallback (line 24). Constructor requires `artifactsDir: string` (non-optional). Add `smtp`/`imap` to the `ToolContext` it builds. |
| `src/core/tools/base.ts` | Make `artifactsDir` required in `ToolContext`. Add optional `smtp` and `imap` fields. |
| `src/core/tools/writeFile.ts` | Remove `process.env.ARTIFACTS_DIR` fallback in `getArtifactsDir()` — just use `ctx.artifactsDir`. |
| `src/core/tools/readFile.ts` | Same as writeFile. |
| `src/core/tools/glob.ts` | Same. |
| `src/core/tools/grep.ts` | Same. |
| `src/core/tools/edit.ts` | Same. |
| `src/core/tools/bash.ts` | Same. |
| `src/core/tools/sendEmail.ts` | Remove all `process.env.SMTP_*` reads. Use `ctx.smtp`. |
| `src/core/tools/readEmail.ts` | Remove all `process.env.IMAP_*` / `SMTP_*` reads. Use `ctx.imap`. |
| `src/core/execution/dagExecutor.ts` | Remove `process.env.ARTIFACTS_DIR` fallback (line 125). Require `artifactsDir` in config. |
| `src/core/execution/dags.ts` | Remove `process.env.ARTIFACTS_DIR` fallback (line 164). Remove `process.env.STALE_EXECUTION_MINUTES` (line 987). Accept both via `deps`. |
| `src/db/client.ts` | `createDatabase` accepts `isMemoryDb` flag. Skip `mkdirSync`, `existsSync`, WAL pragma when true. Log warning about non-persistence. |

#### 7. Rules for downstream consumers after this change

1. **Never read `process.env` for values that are in `ResolvedConfig`.**
2. **Never apply your own default** — the value you receive is already final.
3. **Extending is fine** — e.g. `resolve(ctx.artifactsDir, executionId)` to create a sub-directory is expected.
4. **New env vars** must be added to `ResolvedConfig` and resolved in `resolveConfig()`. No ad-hoc `process.env` reads elsewhere.
