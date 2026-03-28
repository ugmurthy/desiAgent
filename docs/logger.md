# Logger Implementation Documentation

## Overview

This codebase uses **Pino** as the logging library.

## Logger Library

- **pino** v8.17.2 - Core logger
- **pino-pretty** v13.1.3 - Pretty console output
- **pino-roll** v4.0.0 - File rotation transport

## Key Files

| File | Purpose |
|------|---------|
| `desiAgent/src/util/logger.ts` | Main logger implementation |
| `desiAgent/src/types/config.ts` | Logger config types |
| `desiBackend/src/app.ts` | Fastify logger configuration |
| `desiBackend/.env` | LOG_LEVEL, LOG_DEST environment variables |

## When Does It Write to Log File?

**Controlled by `LOG_DEST` env var:**

| Value | Behavior |
|-------|----------|
| `console` (default) | Writes to stdout via pino-pretty |
| `file` | Writes to file via pino-roll with daily rotation |
| `both` | Writes to both console AND file simultaneously |

**File location:** `~/.desiAgent/logs/app.<n>.log`

**Rotation:** Daily (new file created each day, count-based naming)

## Logger Setup Code

### desiAgent Logger (desiAgent/src/util/logger.ts)

```typescript
import pino, { Logger, LoggerOptions } from 'pino';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import { homedir } from 'os';
import type { LogLevel } from '../types/config.js';

let logger: Logger | null = null;

function ensureLogDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function createFileTransport(logDir: string, level: string) {
  return {
    target: 'pino-roll',
    level,
    options: {
      file: join(logDir, 'app'),
      frequency: 'daily',
      mkdir: true,
      extension: '.log',
    },
  };
}

function createConsoleTransport(level: string) {
  return {
    target: 'pino-pretty',
    level,
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  };
}

export function initializeLogger(
  level?: LogLevel,
  logDest?: 'console' | 'file' | 'both',
  logDir?: string,
): Logger {
  const effectiveLevel: string = level ?? 'silent';
  const validLevels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'];
  const levelToUse = validLevels.includes(effectiveLevel) ? effectiveLevel : 'silent';

  const dest = logDest ?? 'console';
  const dir = logDir ?? join(homedir(), '.desiAgent', 'logs');

  const options: LoggerOptions = { level: levelToUse };

  if (dest === 'console') {
    options.transport = createConsoleTransport(levelToUse);
  } else if (dest === 'file') {
    ensureLogDir(dir);
    options.transport = createFileTransport(dir, levelToUse);
  } else if (dest === 'both') {
    ensureLogDir(dir);
    options.transport = {
      targets: [
        createConsoleTransport(levelToUse),
        createFileTransport(dir, levelToUse),
      ],
    };
  }

  const newLogger = pino(options);
  if (logger) {
    logger.level = levelToUse;
  }
  logger = newLogger;
  return logger;
}

export function getLogger(): Logger {
  if (!logger) {
    logger = initializeLogger();
  }
  return logger;
}

export const log = {
  debug: (msg: string, data?: any) => getLogger().debug(data, msg),
  info: (msg: string, data?: any) => getLogger().info(data, msg),
  warn: (msg: string, data?: any) => getLogger().warn(data, msg),
  error: (msg: string, data?: any) => getLogger().error(data, msg),
};

export default getLogger;
```

## Log Format Configuration

### Console Output Format (pino-pretty)

```typescript
options: {
  colorize: true,              // ANSI colors enabled
  translateTime: 'SYS:standard', // Human-readable timestamps
  ignore: 'pid,hostname',       // Excludes PID and hostname from output
}
```

### File Output Format (pino-roll)

```typescript
options: {
  file: join(logDir, 'app'),
  frequency: 'daily',
  mkdir: true,
  extension: '.log',
}
```

File output is **JSON** format. Daily rotation produces count-based filenames: `app.1.log`, `app.2.log`, etc.

## Available pino-pretty Options

| Option | Description |
|--------|-------------|
| `colorize` | Enable/disable ANSI colors (true/false) |
| `translateTime` | Timestamp format: `'SYS:standard'`, `'ISO'`, or `false` for unix timestamp |
| `ignore` | Comma-separated fields to exclude (e.g., `'pid,hostname'`) |
| `include` | Only show specific fields |
| `singleLine` | Multi-line output for objects |

## Available pino-roll Options

| Option | Description |
|--------|-------------|
| `file` | Path to log file (without extension) |
| `frequency` | `'daily'` or `'hourly'` rotation |
| `dateFormat` | Date format string (e.g., `'yyyy-MM-dd'`) for date-based filenames |
| `extension` | File extension (default: `.log`) |
| `mkdir` | Create directory if missing (true/false) |
| `size` | Max file size before rotation (e.g., `'10m'`, `'100k'`) |

## Environment Variables

```bash
LOG_LEVEL=info          # Valid: trace, debug, info, warn, error, fatal, silent
LOG_DEST=both           # Valid: console, file, both
LOG_DIR=/custom/path    # Optional custom log directory
```

## Fastify Logger

desiBackend uses Fastify's built-in Pino logger at `src/app.ts:27`:

```typescript
export async function buildApp() {
  const app = Fastify({
    logger: true,  // Enables Fastify's built-in Pino logger
  });
```

## File Naming (pino-roll)

pino-roll naming format: `filename.date.count.extension`

| Config | Filename Example |
|--------|------------------|
| No `dateFormat` | `app.1.log`, `app.2.log` |
| With `dateFormat: 'yyyy-MM-dd'` | `app.2026-03-26.log` |
| Combined | `app.2026-03-26.1.log` |

## Current Limitations

1. **File format is JSON** - To change to text format, use a custom transport or serializer
2. **File naming is count-based** - Add `dateFormat` option to use date-based naming
3. **Some files use console.log directly** - Bypasses Pino:
   - `desiBackend/src/index.ts`
   - `desiBackend/src/services/bootstrap.ts`
   - `desiBackend/src/services/admin-api-key.ts`
   - `desiBackend/src/services/agents-seed.ts`
