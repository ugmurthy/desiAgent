/**
 * desiAgent Error Classes
 *
 * Custom error hierarchy for desiAgent library.
 */

/**
 * Base error class for all desiAgent errors
 */
export class DesiAgentError extends Error {
  code: string;
  statusCode: number;
  cause?: Error;

  constructor(message: string, code: string = 'DESI_ERROR', statusCode: number = 500, cause?: Error) {
    super(message);
    this.name = 'DesiAgentError';
    this.code = code;
    this.statusCode = statusCode;
    this.cause = cause;

    // Maintain proper prototype chain
    Object.setPrototypeOf(this, DesiAgentError.prototype);
  }
}

/**
 * Configuration error - invalid or missing configuration
 */
export class ConfigurationError extends DesiAgentError {
  constructor(message: string, cause?: Error) {
    super(message, 'CONFIG_ERROR', 400, cause);
    this.name = 'ConfigurationError';
    Object.setPrototypeOf(this, ConfigurationError.prototype);
  }
}

/**
 * Not found error - resource not found in database
 */
export class NotFoundError extends DesiAgentError {
  resourceType: string;
  resourceId: string;

  constructor(resourceType: string, resourceId: string) {
    super(
      `${resourceType} not found: ${resourceId}`,
      'NOT_FOUND',
      404
    );
    this.name = 'NotFoundError';
    this.resourceType = resourceType;
    this.resourceId = resourceId;
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}

/**
 * Validation error - invalid input
 */
export class ValidationError extends DesiAgentError {
  field: string;
  value: any;

  constructor(message: string, field: string, value?: any) {
    super(message, 'VALIDATION_ERROR', 400);
    this.name = 'ValidationError';
    this.field = field;
    this.value = value;
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

/**
 * Execution error - error during goal/DAG execution
 */
export class ExecutionError extends DesiAgentError {
  executionId: string;
  stepIndex?: number;

  constructor(message: string, executionId: string, stepIndex?: number, cause?: Error) {
    super(message, 'EXECUTION_ERROR', 500, cause);
    this.name = 'ExecutionError';
    this.executionId = executionId;
    this.stepIndex = stepIndex;
    Object.setPrototypeOf(this, ExecutionError.prototype);
  }
}

/**
 * Database error - error accessing or querying database
 */
export class DatabaseError extends DesiAgentError {
  operation: string;

  constructor(message: string, operation: string, cause?: Error) {
    super(message, 'DATABASE_ERROR', 500, cause);
    this.name = 'DatabaseError';
    this.operation = operation;
    Object.setPrototypeOf(this, DatabaseError.prototype);
  }
}

/**
 * LLM provider error - error from LLM provider (OpenAI, Ollama, etc.)
 */
export class LLMProviderError extends DesiAgentError {
  provider: string;

  constructor(message: string, provider: string, cause?: Error) {
    super(message, 'LLM_PROVIDER_ERROR', 502, cause);
    this.name = 'LLMProviderError';
    this.provider = provider;
    Object.setPrototypeOf(this, LLMProviderError.prototype);
  }
}

/**
 * Tool error - error executing a tool
 */
export class ToolError extends DesiAgentError {
  toolName: string;

  constructor(message: string, toolName: string, cause?: Error) {
    super(message, 'TOOL_ERROR', 500, cause);
    this.name = 'ToolError';
    this.toolName = toolName;
    Object.setPrototypeOf(this, ToolError.prototype);
  }
}

/**
 * Timeout error - operation exceeded timeout
 */
export class TimeoutError extends DesiAgentError {
  timeout: number;

  constructor(message: string, timeout: number) {
    super(message, 'TIMEOUT', 408);
    this.name = 'TimeoutError';
    this.timeout = timeout;
    Object.setPrototypeOf(this, TimeoutError.prototype);
  }
}

/**
 * Initialization error - error during client initialization
 */
export class InitializationError extends DesiAgentError {
  component: string;

  constructor(message: string, component: string, cause?: Error) {
    super(message, 'INIT_ERROR', 500, cause);
    this.name = 'InitializationError';
    this.component = component;
    Object.setPrototypeOf(this, InitializationError.prototype);
  }
}
