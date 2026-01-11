import pino, { Logger, LoggerOptions } from 'pino';
import type { LogLevel } from '../types/config.js';

let logger: Logger | null = null;

/**
 * Initialize the global logger with the specified level
 */
export function initializeLogger(level: LogLevel = 'info'): Logger {
  const options: LoggerOptions = {
    level,
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    },
  };

  logger = pino(options);
  return logger;
}

/**
 * Get the global logger instance
 */
export function getLogger(): Logger {
  if (!logger) {
    logger = initializeLogger('info');
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
