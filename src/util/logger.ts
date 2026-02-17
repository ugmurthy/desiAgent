import pino, { Logger, LoggerOptions } from 'pino';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import { homedir } from 'os';
import type { LogLevel } from '../types/config.js';

let logger: Logger | null = null;

type LogDest = 'console' | 'file' | 'both';

function getLogDest(): LogDest {
  const dest = process.env.LOG_DEST?.toLowerCase();
  if (dest === 'file' || dest === 'both') {
    return dest;
  }
  return 'console';
}

function getLogDir(): string {
  return process.env.LOG_DIR || join(homedir(), '.desiAgent', 'logs');
}

function ensureLogDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function createFileTransport(logDir: string) {
  return {
    target: 'pino-roll',
    options: {
      file: join(logDir, 'app'),
      frequency: 'daily',
      mkdir: true,
      extension: '.log',
    },
  };
}

function createConsoleTransport() {
  return {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  };
}

/**
 * Initialize the global logger with the specified level
 */
// export function initializeLogger(level: LogLevel = 'info'): Logger {
//   const logDest = getLogDest();
//   const logDir = getLogDir();

//   const options: LoggerOptions = { level };

//   if (logDest === 'console') {
//     options.transport = createConsoleTransport();
//   } else if (logDest === 'file') {
//     ensureLogDir(logDir);
//     options.transport = createFileTransport(logDir);
//   } else if (logDest === 'both') {
//     ensureLogDir(logDir);
//     options.transport = {
//       targets: [
//         createConsoleTransport(),
//         createFileTransport(logDir),
//       ],
//     };
//   }

//   logger = pino(options);
//   return logger;
// }

/**
 * Get the global logger instance
 */
// export function getLogger(): Logger {
//   if (!logger) {
//     logger = initializeLogger('info');
//   }
//   return logger;
// }
/**
 * Initialize the global logger with the specified level
 * Priority: explicit level > LOG_LEVEL env var > 'silent' (default)
 */
export function initializeLogger(level?: LogLevel): Logger {
  const effectiveLevel: string = level 
    ?? process.env.LOG_LEVEL?.toLowerCase() 
    ?? 'silent';

  // Validate if needed (optional, Pino will ignore invalid levels gracefully)
  const validLevels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'];
  const levelToUse = validLevels.includes(effectiveLevel) ? effectiveLevel : 'silent';

  const logDest = getLogDest();
  const logDir = getLogDir();

  const options: LoggerOptions = { level: levelToUse };

  // Still configure transports based on LOG_DEST, but they will be inactive when level is 'silent'
  if (logDest === 'console') {
    options.transport = createConsoleTransport();
  } else if (logDest === 'file') {
    ensureLogDir(logDir);
    options.transport = createFileTransport(logDir);
  } else if (logDest === 'both') {
    ensureLogDir(logDir);
    options.transport = {
      targets: [
        createConsoleTransport(),
        createFileTransport(logDir),
      ],
    };
  }

  const newLogger = pino(options);
  if (logger) {
    // Update existing instance's level so stale references also pick up the new level
    logger.level = levelToUse;
  }
  logger = newLogger;
  return logger;
}

/**
 * Get the global logger instance
 */
export function getLogger(): Logger {
  if (!logger) {
    // Auto-initialize with no explicit level → uses env or defaults to silent
    logger = initializeLogger();
  }
  return logger;
}
/**
 * Convenience function for logging
 */
export const log = {
  debug: (msg: string, data?: any) => getLogger().debug(data, msg),
  info: (msg: string, data?: any) => getLogger().info(data, msg),
  warn: (msg: string, data?: any) => getLogger().warn(data, msg),
  error: (msg: string, data?: any) => getLogger().error(data, msg),
 
};

export default getLogger;
