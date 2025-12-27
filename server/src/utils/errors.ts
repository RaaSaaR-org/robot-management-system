/**
 * @file errors.ts
 * @description Custom error hierarchy for consistent error handling
 * @feature core
 */

/**
 * Base application error with HTTP status code support
 */
export class AppError extends Error {
  /** HTTP status code */
  public readonly statusCode: number;
  /** Error code for programmatic handling */
  public readonly code: string;
  /** Whether this error is operational (expected) or programming error */
  public readonly isOperational: boolean;
  /** Additional context data */
  public readonly context?: Record<string, unknown>;

  constructor(
    message: string,
    statusCode: number = 500,
    code: string = 'INTERNAL_ERROR',
    context?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    this.context = context;

    // Maintains proper stack trace for where error was thrown
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Convert to JSON-serializable object
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      statusCode: this.statusCode,
      ...(this.context && { context: this.context }),
    };
  }
}

// ============================================================================
// CLIENT ERRORS (4xx)
// ============================================================================

/**
 * 400 Bad Request - Invalid input or malformed request
 */
export class BadRequestError extends AppError {
  constructor(message: string = 'Bad request', context?: Record<string, unknown>) {
    super(message, 400, 'BAD_REQUEST', context);
  }
}

/**
 * 401 Unauthorized - Missing or invalid authentication
 */
export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication required', context?: Record<string, unknown>) {
    super(message, 401, 'AUTHENTICATION_REQUIRED', context);
  }
}

/**
 * 403 Forbidden - Authenticated but not authorized
 */
export class AuthorizationError extends AppError {
  constructor(message: string = 'Access denied', context?: Record<string, unknown>) {
    super(message, 403, 'ACCESS_DENIED', context);
  }
}

/**
 * 404 Not Found - Resource does not exist
 */
export class NotFoundError extends AppError {
  constructor(
    resource: string = 'Resource',
    identifier?: string,
    context?: Record<string, unknown>
  ) {
    const message = identifier ? `${resource} '${identifier}' not found` : `${resource} not found`;
    super(message, 404, 'NOT_FOUND', { resource, identifier, ...context });
  }
}

/**
 * 409 Conflict - Resource conflict (e.g., duplicate)
 */
export class ConflictError extends AppError {
  constructor(message: string = 'Resource conflict', context?: Record<string, unknown>) {
    super(message, 409, 'CONFLICT', context);
  }
}

/**
 * 422 Unprocessable Entity - Validation failed
 */
export class ValidationError extends AppError {
  /** Validation error details by field */
  public readonly errors: Record<string, string[]>;

  constructor(errors: Record<string, string[]>, message: string = 'Validation failed') {
    super(message, 422, 'VALIDATION_ERROR', { errors });
    this.errors = errors;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      errors: this.errors,
    };
  }
}

/**
 * 429 Too Many Requests - Rate limit exceeded
 */
export class RateLimitError extends AppError {
  /** Seconds until rate limit resets */
  public readonly retryAfter?: number;

  constructor(message: string = 'Rate limit exceeded', retryAfter?: number) {
    super(message, 429, 'RATE_LIMIT_EXCEEDED', { retryAfter });
    this.retryAfter = retryAfter;
  }
}

// ============================================================================
// SERVER ERRORS (5xx)
// ============================================================================

/**
 * 500 Internal Server Error - Unexpected server error
 */
export class InternalError extends AppError {
  constructor(message: string = 'Internal server error', context?: Record<string, unknown>) {
    super(message, 500, 'INTERNAL_ERROR', context);
  }
}

/**
 * 502 Bad Gateway - Error communicating with upstream service
 */
export class GatewayError extends AppError {
  constructor(
    service: string,
    message: string = 'Upstream service error',
    context?: Record<string, unknown>
  ) {
    super(message, 502, 'GATEWAY_ERROR', { service, ...context });
  }
}

/**
 * 503 Service Unavailable - Service temporarily unavailable
 */
export class ServiceUnavailableError extends AppError {
  constructor(message: string = 'Service temporarily unavailable', context?: Record<string, unknown>) {
    super(message, 503, 'SERVICE_UNAVAILABLE', context);
  }
}

/**
 * 504 Gateway Timeout - Upstream service timeout
 */
export class TimeoutError extends AppError {
  constructor(
    service: string,
    timeoutMs: number,
    context?: Record<string, unknown>
  ) {
    super(`${service} timed out after ${timeoutMs}ms`, 504, 'TIMEOUT', {
      service,
      timeoutMs,
      ...context,
    });
  }
}

// ============================================================================
// DOMAIN-SPECIFIC ERRORS
// ============================================================================

/**
 * Robot-related errors
 */
export class RobotError extends AppError {
  constructor(
    robotId: string,
    message: string,
    code: string = 'ROBOT_ERROR',
    statusCode: number = 400,
    context?: Record<string, unknown>
  ) {
    super(message, statusCode, code, { robotId, ...context });
  }
}

/**
 * Robot not connected
 */
export class RobotOfflineError extends RobotError {
  constructor(robotId: string) {
    super(robotId, `Robot '${robotId}' is offline`, 'ROBOT_OFFLINE', 503);
  }
}

/**
 * Robot command failed
 */
export class RobotCommandError extends RobotError {
  constructor(robotId: string, command: string, reason: string) {
    super(robotId, `Command '${command}' failed: ${reason}`, 'ROBOT_COMMAND_FAILED', 422, {
      command,
      reason,
    });
  }
}

/**
 * Process-related errors
 */
export class ProcessError extends AppError {
  constructor(
    processId: string,
    message: string,
    code: string = 'PROCESS_ERROR',
    statusCode: number = 400,
    context?: Record<string, unknown>
  ) {
    super(message, statusCode, code, { processId, ...context });
  }
}

/**
 * Process state transition not allowed
 */
export class ProcessStateError extends ProcessError {
  constructor(processId: string, currentState: string, action: string) {
    super(
      processId,
      `Cannot ${action} process in '${currentState}' state`,
      'INVALID_PROCESS_STATE',
      409,
      { currentState, action }
    );
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Check if error is an operational error (expected, can be handled gracefully)
 */
export function isOperationalError(error: unknown): error is AppError {
  return error instanceof AppError && error.isOperational;
}

/**
 * Wrap unknown errors in AppError
 */
export function wrapError(error: unknown, fallbackMessage: string = 'An error occurred'): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof Error) {
    return new InternalError(error.message);
  }

  return new InternalError(fallbackMessage);
}

/**
 * Create error response object for HTTP responses
 */
export function errorResponse(error: AppError): {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
} {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.context && { details: error.context }),
    },
  };
}
