# PRD: initDB Service

## Introduction

Create a new `initDB` service for desiAgent that programmatically creates a SQLite database with all tables defined in the schema. This service encapsulates the database initialization logic currently in `scripts/create-db.ts` into a reusable service that can be called from within the application.

## Goals

- Provide a programmatic way to initialize a new database with the current schema
- Support optional force mode to overwrite existing databases
- Return clear success/error responses with table information
- Configure database with WAL mode and foreign key support

## User Stories

### US-001: Create initDB service file
**Description:** As a developer, I need a new service module to house the database initialization logic.

**Acceptance Criteria:**
- [ ] Create `src/services/initDB.ts`
- [ ] Export an async function `initDB(dbPath: string, options?: InitDBOptions): Promise<InitDBResult>`
- [ ] Define `InitDBOptions` type with `force?: boolean`
- [ ] Define `InitDBResult` type with `{ success: boolean; message: string; tables?: string[] }`
- [ ] Typecheck passes

### US-002: Validate database path
**Description:** As a developer, I want the service to validate the database path before attempting creation.

**Acceptance Criteria:**
- [ ] Return error if `dbPath` is empty or undefined
- [ ] Return error if parent directory does not exist
- [ ] Return error if database file exists and `force` is not set
- [ ] Typecheck passes

### US-003: Handle force option
**Description:** As a developer, I want to optionally force-overwrite an existing database.

**Acceptance Criteria:**
- [ ] When `force: true` and file exists, delete the existing database
- [ ] Also delete associated `-wal` and `-shm` files if they exist
- [ ] Proceed with database creation after deletion
- [ ] Typecheck passes

### US-004: Generate and execute schema SQL
**Description:** As a developer, I want the service to create all tables from the current schema.

**Acceptance Criteria:**
- [ ] Reuse SQL generation logic from `scripts/create-db.ts`
- [ ] Create tables: `agents`, `dags`, `dag_executions`, `dag_sub_steps`
- [ ] Create indexes defined in the schema
- [ ] Create the `executions` view
- [ ] Typecheck passes

### US-005: Configure database pragmas
**Description:** As a developer, I want the database configured with optimal settings.

**Acceptance Criteria:**
- [ ] Set `PRAGMA journal_mode = WAL`
- [ ] Set `PRAGMA foreign_keys = ON`
- [ ] Apply pragmas before creating tables
- [ ] Typecheck passes

### US-006: Return success response with table list
**Description:** As a developer, I want a clear success response with the list of created tables.

**Acceptance Criteria:**
- [ ] On success, return `{ success: true, message: "Database created successfully", tables: [...] }`
- [ ] `tables` array includes all table names created
- [ ] Typecheck passes

### US-007: Return error responses
**Description:** As a developer, I want clear error responses when initialization fails.

**Acceptance Criteria:**
- [ ] On error, return `{ success: false, message: "<descriptive error>" }`
- [ ] Error message describes the specific failure reason
- [ ] Do not throw exceptions; return error result instead
- [ ] Typecheck passes

## Functional Requirements

- FR-1: Create async `initDB(dbPath: string, options?: { force?: boolean }): Promise<InitDBResult>` function
- FR-2: Validate that `dbPath` is provided and non-empty
- FR-3: Validate that parent directory of `dbPath` exists; return error if not
- FR-4: If database file exists and `force` is false/undefined, return error
- FR-5: If database file exists and `force` is true, delete it and associated WAL/SHM files
- FR-6: Create new SQLite database at `dbPath`
- FR-7: Execute `PRAGMA journal_mode = WAL` and `PRAGMA foreign_keys = ON`
- FR-8: Generate CREATE TABLE statements from `src/db/schema.ts`
- FR-9: Execute all CREATE TABLE, CREATE INDEX, and CREATE VIEW statements
- FR-10: Return success result with list of created tables on success
- FR-11: Return error result with descriptive message on any failure

## Non-Goals

- Auto-creating parent directories (user must ensure directory exists)
- Database migrations or schema updates
- Configurable pragma options
- Connection pooling or keeping the database open
- Seeding initial data

## Technical Considerations

- Reuse/refactor SQL generation functions from `scripts/create-db.ts`
- Use `bun:sqlite` for database operations (same as existing script)
- Import schema from `src/db/schema.ts`
- Close database connection after creation
- Handle all errors gracefully without throwing

## Success Metrics

- Service can create a new database in under 100ms
- All tables from schema are created correctly
- Error messages are actionable and specific
- Existing tests continue to pass

## Open Questions

None - all questions resolved.
