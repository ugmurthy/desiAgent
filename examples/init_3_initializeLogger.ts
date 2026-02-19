#!/usr/bin/env bun
/**
 * init_3_initializeLogger.ts — initializeLogger() signature changed.
 *
 * Old: initializeLogger(level?)            — read LOG_DEST/LOG_DIR from env
 * New: initializeLogger(level?, logDest?, logDir?)  — all explicit
 *
 * Usage: bun run examples/init_3_initializeLogger.ts
 */

import { initializeLogger, getLogger } from '../src/util/logger.js';

// Minimal: just level (logDest defaults to 'console', logDir to ~/.desiAgent/logs)
initializeLogger('info');
const log1 = getLogger();
log1.info('Logger with level only');

// Full: explicit dest and dir
initializeLogger('debug', 'file', '/tmp/desiagent-logs');
const log2 = getLogger();
log2.debug('Logger writing to /tmp/desiagent-logs');

// Both console and file
initializeLogger('info', 'both', '/tmp/desiagent-logs');
const log3 = getLogger();
log3.info('Logger writing to console AND file');
