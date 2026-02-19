# Implementation Plan: Single Source of Truth for Configuration

> Reference: [initialisation-issues.md](./initialisation-issues.md) — bugs, corner cases, and design rationale.

## Goal

All environment variables are read **once** in `resolveConfig()`. All defaults are applied **once**. The resulting frozen `ResolvedConfig` is threaded to every consumer. No downstream code reads `process.env` or applies its own fallbacks.

**In-memory database (`':memory:'`)** is a first-class option: `initDB()` seeds tables + agents, `artifactsDir` defaults to `$HOME/.desiAgent/artifacts`, and `shutdown()` warns about data loss.

---

## Phase 1 — `ResolvedConfig` type + `resolveConfig()` function

### 1a. Add `ResolvedConfig` interface to `src/types/config.ts`

```ts
export interface ResolvedConfig {
  databasePath: string;
  isMemoryDb: boolean;
  artifactsDir: string;

  llmProvider: 'openai' | 'openrouter' | 'ollama';
  modelName: string;
  apiKey: string | undefined;   // resolved for the active provider only
  ollamaBaseUrl: string;

  agentDefinitionsPath: string;

  logLevel: LogLevel;
  logDest: 'console' | 'file' | 'both';
  logDir: string;

  smtp: Readonly<{
    host: string | undefined;
    port: number;
    user: string | undefined;
    pass: string | undefined;
    from: string | undefined;
  }>;

  imap: Readonly<{
    host: string;
    port: number;
    user: string | undefined;
    pass: string | undefined;
  }>;

  staleExecutionMinutes: number;
  autoStartScheduler: boolean;
  enableToolValidation: boolean;
}
```

### 1b. Add `resolveConfig()` to `src/types/config.ts`

- Import `homedir` from `os`, `resolve`/`dirname` from `path`.
- Replace the `HOME || USERPROFILE || '~'` pattern with `homedir()` (fixes Bug 5).
- Resolve `apiKey` via a provider switch (fixes Bug 1).
- Return `Object.freeze(...)`.

Key in-memory behaviour:
```ts
const isMemoryDb = databasePath === ':memory:';
const artifactsDir = validated.artifactsDir
  ?? process.env.ARTIFACTS_DIR
  ?? (isMemoryDb
    ? resolve(homedir(), '.desiAgent', 'artifacts')   // ← $HOME/.desiAgent/artifacts
    : resolve(dirname(databasePath), 'artifacts'));
```

### 1c. Deprecate `ProcessedDesiAgentConfig`

- Keep as a type alias `type ProcessedDesiAgentConfig = ResolvedConfig` for back-compat.
- Remove the `as ProcessedDesiAgentConfig` cast in `validateConfig` — `resolveConfig` returns the correct type.

### 1d. Harden Zod schema (Bugs 2, 3, 6)

In `DesiAgentConfigSchema`:
- `openaiApiKey`: change to `z.string().min(1).optional()`.
- `openrouterApiKey`: change to `z.string().min(1).optional()`.
- `logLevel`: change to `z.enum([...]).optional().default('info').catch('info')` — invalid env values fall back instead of crashing.
- `artifactsDir`: keep `z.string().optional()` (no Zod default — `resolveConfig` handles it).
- Replace `HOME || USERPROFILE || '~'` in `databasePath` and `agentDefinitionsPath` defaults with `homedir()`.

### Files changed
- `src/types/config.ts`

---

## Phase 2 — Update `setupDesiAgent()` in `src/index.ts`

### New flow

```
DesiAgentConfigSchema.parse(config)
  → resolveConfig(validated)        ← produces frozen ResolvedConfig
  → initializeLogger(resolved)
  → if (resolved.isMemoryDb) await initDB(':memory:')   ← seed tables + agents
  → getDatabase(resolved)
  → init services (pass resolved values, no env reads)
  → createLLMProvider(resolved)
  → return DesiAgentClientImpl
```

### Specific changes

1. Replace `validateConfig` return type from `ProcessedDesiAgentConfig` to just `DesiAgentConfig` (Zod output). Then call `resolveConfig()` separately.

2. Remove inline `artifactsDir` computation (lines 115–116) — already in `resolved.artifactsDir`.

3. Remove `llmProviderConfig` assembly (lines 129–136) — use `resolved` fields directly:
   ```ts
   const llmProvider = createLLMProvider({
     provider: resolved.llmProvider,
     apiKey: resolved.apiKey,
     baseUrl: resolved.ollamaBaseUrl,
     model: resolved.modelName,
   });
   ```

4. Add `:memory:` initDB call:
   ```ts
   if (resolved.isMemoryDb) {
     const result = await initDB(':memory:', { force: true });
     if (!result.success) {
       throw new InitializationError(
         `Failed to initialise in-memory database: ${result.message}`,
         'setupDesiAgent'
       );
     }
     logger.info({ agentsSeeded: result.agentsSeeded }, 'In-memory database initialised with seed data');
   }
   ```

5. Pass `resolved.isMemoryDb` to `DesiAgentClientImpl` so `shutdown()` can warn.

6. Store `resolved` on the client (replaces the `(client as any)._toolExecutor` pattern):
   ```ts
   (client as any)._resolved = resolved;
   ```

### Files changed
- `src/index.ts`

---

## Phase 3 — Update `DesiAgentClientImpl.shutdown()` for `:memory:` warning

```ts
async shutdown(): Promise<void> {
  if ((this as any)._resolved?.isMemoryDb) {
    this.logger.warn('Shutting down in-memory database — all data will be lost');
  }
  this.logger.info('Shutting down desiAgent');
  closeDatabase();
}
```

Alternatively, store `isMemoryDb` as a proper private field on the class.

### Files changed
- `src/index.ts` (DesiAgentClientImpl class)

---

## Phase 4 — Update `src/db/client.ts` for `:memory:`

### 4a. Change `createDatabase` signature

```ts
function createDatabase(dbPath: string, isMemoryDb: boolean): DrizzleDB
```

### 4b. Guard `:memory:` path

```ts
if (!isMemoryDb) {
  const dbDir = dirname(dbPath);
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
    logger.info(`Created database directory: ${dbDir}`);
  }
}

const sqlite = new Database(dbPath);

if (!isMemoryDb) {
  sqlite.exec('PRAGMA journal_mode = WAL;');
}
sqlite.exec('PRAGMA foreign_keys = ON;');

// Always init tables (initDB handles seeding for :memory:, but createDatabase
// still needs CREATE TABLE IF NOT EXISTS for file-based new DBs)
initializeTables(sqlite, logger);
```

### 4c. Update `getDatabase` signature

```ts
export function getDatabase(resolved: { databasePath: string; isMemoryDb: boolean }): DrizzleDB
```

Or keep the two-arg form: `getDatabase(dbPath: string, isMemoryDb: boolean)`.

### 4d. Update `closeDatabase` — accept `isMemoryDb` for warning

This can remain as-is since the shutdown warning is handled in `DesiAgentClientImpl`. `closeDatabase` just nulls the singleton.

### Files changed
- `src/db/client.ts`

---

## Phase 5 — Update `initDB()` for `:memory:` support

`src/services/initDB.ts` currently rejects `:memory:` implicitly (checks `existsSync`, `dirname` etc.).

### Changes

1. Add early `:memory:` branch:
   ```ts
   const isMemoryDb = dbPath === ':memory:';

   if (isMemoryDb) {
     // Skip file-system checks (existsSync, dirname, unlinkSync)
     const sqlite = new Database(':memory:');
     sqlite.exec('PRAGMA foreign_keys = ON;');
     // No WAL for in-memory
     const { sql, tableNames } = generateAllSQL();
     sqlite.exec(sql);
     const agentsSeeded = seedAgents(sqlite);
     // Do NOT close — caller needs this connection
     // But current API closes... see note below
   }
   ```

2. **Problem:** `initDB` currently calls `sqlite.close()` at line 261 and returns a result object. For `:memory:`, closing destroys all data. The DB connection must be the same one used by `getDatabase`.

   **Solution:** For `:memory:`, `setupDesiAgent` should call `getDatabase(':memory:')` first (which creates the connection + tables via `createDatabase`), then seed agents separately. Extract `seedAgents` into an exported function or have `initDB` accept an existing `Database` handle.

   Recommended approach:
   - Export `seedAgents` from `initDB.ts` (or a new `src/services/seedAgents.ts`).
   - In `setupDesiAgent`, after `getDatabase()`, call `seedAgents(db)` when `isMemoryDb`.
   - `initDB()` itself remains for CLI/standalone use with file-based DBs.

### Files changed
- `src/services/initDB.ts` — export `seedAgents`
- `src/index.ts` — call `seedAgents` for `:memory:` instead of `initDB`

---

## Phase 6 — Update `initializeLogger()` in `src/util/logger.ts`

### Change signature

```ts
export function initializeLogger(opts: {
  level?: LogLevel;
  dest?: 'console' | 'file' | 'both';
  dir?: string;
}): Logger
```

### Remove `process.env` reads

- Remove `getLogDest()` helper (reads `process.env.LOG_DEST`).
- Remove `getLogDir()` helper (reads `process.env.LOG_DIR`).
- Remove `process.env.LOG_LEVEL` fallback in `initializeLogger`.
- All three values come from the `opts` parameter (sourced from `ResolvedConfig`).

### `getLogger()` auto-init

Keep the lazy-init in `getLogger()`, but use hardcoded safe defaults (level: `'silent'`, dest: `'console'`) since `getLogger` can be called before `setupDesiAgent`:

```ts
export function getLogger(): Logger {
  if (!logger) {
    logger = initializeLogger({ level: 'silent', dest: 'console', dir: '' });
  }
  return logger;
}
```

### Files changed
- `src/util/logger.ts`

---

## Phase 7 — Remove `process.env.OPENROUTER_API_KEY` fallback from factory

### Change in `src/core/providers/factory.ts`

Line 63 — remove env fallback:
```ts
// Before
const apiKey = config.apiKey || process.env.OPENROUTER_API_KEY;

// After
const apiKey = config.apiKey;
```

The key is already resolved in `resolveConfig()`.

### Also: include API key in cache key (Bug 7)

```ts
const cacheKey = `${config.provider}:${model}:${maxTokens}:${config.apiKey ?? ''}`;
```

### Files changed
- `src/core/providers/factory.ts`

---

## Phase 8 — Remove `process.env.ARTIFACTS_DIR` from all tools and services

Every file below has the same pattern:
```ts
ctx.artifactsDir || process.env.ARTIFACTS_DIR || './artifacts'
```

Replace with just:
```ts
ctx.artifactsDir
```

### 8a. Make `artifactsDir` required in `ToolContext`

In `src/core/tools/base.ts`:
```ts
artifactsDir: string;   // was: artifactsDir?: string
```

### 8b. Remove fallback in each tool

| File | Method | Change |
|---|---|---|
| `src/core/tools/writeFile.ts` | `getArtifactsDir()` | `return resolve(ctx.artifactsDir)` |
| `src/core/tools/readFile.ts` | (same pattern) | Same |
| `src/core/tools/glob.ts` | (same pattern) | Same |
| `src/core/tools/grep.ts` | (same pattern) | Same |
| `src/core/tools/edit.ts` | (same pattern) | Same |
| `src/core/tools/bash.ts` | (same pattern) | Same |
| `src/core/tools/sendEmail.ts` | `resolveAttachmentPath()` | `const artifactsDir = ctx.artifactsDir` |

### 8c. Remove fallback in service constructors

| File | Line | Change |
|---|---|---|
| `src/core/tools/executor.ts` | 24 | `this.artifactsDir = artifactsDir;` (param becomes `artifactsDir: string`, non-optional) |
| `src/core/execution/dagExecutor.ts` | 125 | `this.artifactsDir = config.artifactsDir;` (make `artifactsDir` required in `DAGExecutorConfig`) |
| `src/core/execution/dags.ts` | 164 | `this.artifactsDir = deps.artifactsDir;` (make `artifactsDir` required in `DAGsServiceDeps`) |

### 8d. Update interfaces

```ts
// DAGsServiceDeps
artifactsDir: string;   // was: artifactsDir?: string

// DAGExecutorConfig
artifactsDir: string;   // was: artifactsDir?: string
```

### Files changed
- `src/core/tools/base.ts`
- `src/core/tools/writeFile.ts`
- `src/core/tools/readFile.ts`
- `src/core/tools/glob.ts`
- `src/core/tools/grep.ts`
- `src/core/tools/edit.ts`
- `src/core/tools/bash.ts`
- `src/core/tools/sendEmail.ts`
- `src/core/tools/executor.ts`
- `src/core/execution/dagExecutor.ts`
- `src/core/execution/dags.ts`

---

## Phase 9 — Remove `process.env.SMTP_*` / `IMAP_*` from email tools

### 9a. Add `smtp` and `imap` to `ToolContext`

In `src/core/tools/base.ts`:
```ts
export interface ToolContext {
  // ... existing fields ...
  artifactsDir: string;
  smtp?: {
    host: string | undefined;
    port: number;
    user: string | undefined;
    pass: string | undefined;
    from: string | undefined;
  };
  imap?: {
    host: string;
    port: number;
    user: string | undefined;
    pass: string | undefined;
  };
}
```

### 9b. Populate in `ToolExecutor`

In `src/core/tools/executor.ts`, the constructor accepts `ResolvedConfig` (or just `smtp`/`imap` fields) and populates the context:

```ts
constructor(registry: ToolRegistry, artifactsDir: string, smtp?: ResolvedConfig['smtp'], imap?: ResolvedConfig['imap']) {
  this.registry = registry;
  this.artifactsDir = artifactsDir;
  this.smtp = smtp;
  this.imap = imap;
}

// In execute():
const ctx: ToolContext = {
  // ...existing...
  artifactsDir: resolve(this.artifactsDir),
  smtp: this.smtp,
  imap: this.imap,
};
```

### 9c. Update `SendEmailTool`

Replace `getTransporter()`:
```ts
private getTransporter(ctx: ToolContext): Transporter {
  if (this.transporter) return this.transporter;

  const smtp = ctx.smtp;
  if (!smtp?.host || !smtp?.user || !smtp?.pass || !smtp?.from) {
    throw new Error('SMTP configuration missing. Provide smtp config via setupDesiAgent or env vars.');
  }
  // ... create transporter from smtp fields ...
}
```

Remove all `process.env.SMTP_*` reads. Remove `process.env.SMTP_FROM!` on line 106.

### 9d. Update `ReadEmailTool`

Replace `getImapConfig()`:
```ts
private getImapConfig(ctx: ToolContext) {
  const imap = ctx.imap;
  if (!imap?.user || !imap?.pass) {
    throw new Error('IMAP configuration missing. Provide imap config via setupDesiAgent or env vars.');
  }
  return imap;
}
```

Remove all `process.env.IMAP_*` / `process.env.SMTP_*` reads.

### Files changed
- `src/core/tools/base.ts`
- `src/core/tools/executor.ts`
- `src/core/tools/sendEmail.ts`
- `src/core/tools/readEmail.ts`

---

## Phase 10 — Remove `process.env.STALE_EXECUTION_MINUTES` from `dags.ts`

### 10a. Add to `DAGsServiceDeps`

```ts
export interface DAGsServiceDeps {
  // ... existing ...
  staleExecutionMinutes?: number;   // defaults handled in resolveConfig
}
```

### 10b. Store in constructor

```ts
this.staleExecutionMinutes = deps.staleExecutionMinutes ?? 5;
```

### 10c. Replace usage at line 987

```ts
// Before
const staleMinutes = parseInt(process.env.STALE_EXECUTION_MINUTES || '5', 10);

// After
const staleMinutes = this.staleExecutionMinutes;
```

### 10d. Pass from `setupDesiAgent`

```ts
const dagsService = new DAGsService({
  db,
  llmProvider,
  toolRegistry,
  agentsService,
  artifactsDir: resolved.artifactsDir,
  staleExecutionMinutes: resolved.staleExecutionMinutes,
});
```

### Files changed
- `src/core/execution/dags.ts`
- `src/index.ts`

---

## Phase 11 — Update `setupDesiAgent` call in `index.ts` (calling initDB for :memory:)

This consolidates Phase 2 and Phase 5 decisions. The final `:memory:` handling in `setupDesiAgent`:

```ts
// After resolveConfig, before service init:
const db = getDatabase(resolved.databasePath, resolved.isMemoryDb);

if (resolved.isMemoryDb) {
  // Seed agents into the in-memory DB
  // getDatabase already created tables via createDatabase
  const sqlite = (db as any).$client as Database;  // access underlying bun:sqlite handle
  const { seedAgents } = await import('./services/initDB.js');
  const seeded = seedAgents(sqlite);
  logger.info({ agentsSeeded: seeded }, 'In-memory database seeded');
}
```

> **Note:** `seedAgents` must be exported from `initDB.ts`. It currently isn't — add `export` to the function.

### Files changed
- `src/services/initDB.ts` — export `seedAgents`
- `src/index.ts`

---

## Execution Order

| Order | Phase | Scope | Risk |
|-------|-------|-------|------|
| 1 | Phase 1 | `config.ts` — new type + function | None — additive |
| 2 | Phase 6 | `logger.ts` — remove env reads | Low — signature change |
| 3 | Phase 7 | `factory.ts` — remove env fallback + cache fix | Low |
| 4 | Phase 4 | `client.ts` — `:memory:` guards | Low |
| 5 | Phase 5 | `initDB.ts` — export `seedAgents` | None — additive |
| 6 | Phase 8 | Tools + services — remove `ARTIFACTS_DIR` env | Medium — touches 11 files |
| 7 | Phase 9 | Email tools — remove `SMTP_*`/`IMAP_*` env | Medium — touches 4 files |
| 8 | Phase 10 | `dags.ts` — remove `STALE_EXECUTION_MINUTES` | Low |
| 9 | Phases 2,3,11 | `index.ts` — new flow, `:memory:` seeding, shutdown warning | Medium — central orchestration |

Each phase should be verified with `bun run build` (type-check) and existing tests before proceeding to the next.

---

## Verification Checklist

After all phases:

- [ ] `grep -r 'process\.env\.' src/ --include='*.ts' | grep -v node_modules | grep -v '.test.'` returns **zero** matches (excluding test files)
- [ ] `bun run build` passes with no type errors
- [ ] Existing tests pass (`bun test`)
- [ ] Example `list-sdk.ts` works with `databasePath: ':memory:'`
- [ ] Example `execute-goal.ts` works with file-based DB
- [ ] Shutdown with `:memory:` logs a warning
- [ ] Setting `ARTIFACTS_DIR` env var has no effect (config value wins)
- [ ] `LOG_LEVEL=verbose` doesn't crash (falls back to `'info'`)
