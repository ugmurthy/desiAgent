import { describe, it, expect } from 'vitest';
import {
  DesiAgentError,
  ConfigurationError,
  ExecutionError,
  DatabaseError,
  TimeoutError,
  InitializationError,
} from '../index.js';

describe('ConfigurationError', () => {
  it('sets properties correctly', () => {
    const err = new ConfigurationError('bad config');
    expect(err.message).toBe('bad config');
    expect(err.name).toBe('ConfigurationError');
    expect(err.code).toBe('CONFIG_ERROR');
    expect(err.statusCode).toBe(400);
  });

  it('passes cause through', () => {
    const cause = new Error('root cause');
    const err = new ConfigurationError('bad config', cause);
    expect(err.cause).toBe(cause);
  });

  it('is instanceof DesiAgentError and ConfigurationError', () => {
    const err = new ConfigurationError('test');
    expect(err).toBeInstanceOf(ConfigurationError);
    expect(err).toBeInstanceOf(DesiAgentError);
    expect(err).toBeInstanceOf(Error);
  });
});

describe('ExecutionError', () => {
  it('sets properties correctly', () => {
    const err = new ExecutionError('exec failed', 'exec-123', 2);
    expect(err.message).toBe('exec failed');
    expect(err.name).toBe('ExecutionError');
    expect(err.code).toBe('EXECUTION_ERROR');
    expect(err.statusCode).toBe(500);
    expect(err.executionId).toBe('exec-123');
    expect(err.stepIndex).toBe(2);
  });

  it('allows optional stepIndex', () => {
    const err = new ExecutionError('exec failed', 'exec-456');
    expect(err.stepIndex).toBeUndefined();
  });

  it('passes cause through', () => {
    const cause = new Error('root');
    const err = new ExecutionError('fail', 'id', 0, cause);
    expect(err.cause).toBe(cause);
  });

  it('is instanceof ExecutionError and DesiAgentError', () => {
    const err = new ExecutionError('test', 'id');
    expect(err).toBeInstanceOf(ExecutionError);
    expect(err).toBeInstanceOf(DesiAgentError);
  });
});

describe('DatabaseError', () => {
  it('sets properties correctly', () => {
    const err = new DatabaseError('query failed', 'INSERT');
    expect(err.message).toBe('query failed');
    expect(err.name).toBe('DatabaseError');
    expect(err.code).toBe('DATABASE_ERROR');
    expect(err.statusCode).toBe(500);
    expect(err.operation).toBe('INSERT');
  });

  it('passes cause through', () => {
    const cause = new Error('connection lost');
    const err = new DatabaseError('db error', 'SELECT', cause);
    expect(err.cause).toBe(cause);
  });

  it('is instanceof DatabaseError and DesiAgentError', () => {
    const err = new DatabaseError('test', 'UPDATE');
    expect(err).toBeInstanceOf(DatabaseError);
    expect(err).toBeInstanceOf(DesiAgentError);
  });
});

describe('TimeoutError', () => {
  it('sets properties correctly', () => {
    const err = new TimeoutError('timed out', 5000);
    expect(err.message).toBe('timed out');
    expect(err.name).toBe('TimeoutError');
    expect(err.code).toBe('TIMEOUT');
    expect(err.statusCode).toBe(408);
    expect(err.timeout).toBe(5000);
  });

  it('is instanceof TimeoutError and DesiAgentError', () => {
    const err = new TimeoutError('test', 1000);
    expect(err).toBeInstanceOf(TimeoutError);
    expect(err).toBeInstanceOf(DesiAgentError);
  });
});

describe('InitializationError', () => {
  it('sets properties correctly', () => {
    const err = new InitializationError('init failed', 'DatabaseModule');
    expect(err.message).toBe('init failed');
    expect(err.name).toBe('InitializationError');
    expect(err.code).toBe('INIT_ERROR');
    expect(err.statusCode).toBe(500);
    expect(err.component).toBe('DatabaseModule');
  });

  it('passes cause through', () => {
    const cause = new Error('missing env');
    const err = new InitializationError('init failed', 'Config', cause);
    expect(err.cause).toBe(cause);
  });

  it('is instanceof InitializationError and DesiAgentError', () => {
    const err = new InitializationError('test', 'App');
    expect(err).toBeInstanceOf(InitializationError);
    expect(err).toBeInstanceOf(DesiAgentError);
  });
});
