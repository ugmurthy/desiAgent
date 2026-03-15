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

/**
 * Initialize the global logger with the specified level
 */
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
