/**
 * @file errors.test.ts
 * @description Unit tests for the custom error hierarchy and error utility functions.
 * @feature core
 */

import { describe, it, expect } from 'vitest';
import {
  AppError,
  BadRequestError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  ValidationError,
  RateLimitError,
  InternalError,
  GatewayError,
  ServiceUnavailableError,
  TimeoutError,
  RobotError,
  RobotOfflineError,
  RobotCommandError,
  ProcessError,
  ProcessStateError,
  isOperationalError,
  wrapError,
  errorResponse,
} from '../errors.js';

describe('AppError', () => {
  it('applies defaults when only a message is supplied', () => {
    const err = new AppError('boom');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AppError);
    expect(err.message).toBe('boom');
    expect(err.statusCode).toBe(500);
    expect(err.code).toBe('INTERNAL_ERROR');
    expect(err.isOperational).toBe(true);
    expect(err.context).toBeUndefined();
    expect(err.name).toBe('AppError');
  });

  it('honors explicit statusCode, code, and context', () => {
    const ctx = { foo: 'bar' };
    const err = new AppError('msg', 418, 'TEAPOT', ctx);
    expect(err.statusCode).toBe(418);
    expect(err.code).toBe('TEAPOT');
    expect(err.context).toEqual(ctx);
  });

  it('captures a stack trace', () => {
    const err = new AppError('boom');
    expect(typeof err.stack).toBe('string');
    expect(err.stack).toContain('boom');
  });

  it('sets name from the constructor for subclasses', () => {
    const err = new BadRequestError();
    expect(err.name).toBe('BadRequestError');
  });

  it('toJSON omits context when absent', () => {
    const err = new AppError('msg', 400, 'CODE');
    expect(err.toJSON()).toEqual({
      name: 'AppError',
      message: 'msg',
      code: 'CODE',
      statusCode: 400,
    });
    expect('context' in err.toJSON()).toBe(false);
  });

  it('toJSON includes context when present', () => {
    const err = new AppError('msg', 400, 'CODE', { a: 1 });
    expect(err.toJSON()).toEqual({
      name: 'AppError',
      message: 'msg',
      code: 'CODE',
      statusCode: 400,
      context: { a: 1 },
    });
  });
});

describe('client error subclasses', () => {
  it('BadRequestError defaults and overrides', () => {
    expect(new BadRequestError()).toMatchObject({
      message: 'Bad request',
      statusCode: 400,
      code: 'BAD_REQUEST',
    });
    const custom = new BadRequestError('nope', { field: 'x' });
    expect(custom.message).toBe('nope');
    expect(custom.context).toEqual({ field: 'x' });
  });

  it('AuthenticationError', () => {
    expect(new AuthenticationError()).toMatchObject({
      message: 'Authentication required',
      statusCode: 401,
      code: 'AUTHENTICATION_REQUIRED',
    });
  });

  it('AuthorizationError', () => {
    expect(new AuthorizationError()).toMatchObject({
      message: 'Access denied',
      statusCode: 403,
      code: 'ACCESS_DENIED',
    });
  });

  it('ConflictError', () => {
    expect(new ConflictError()).toMatchObject({
      message: 'Resource conflict',
      statusCode: 409,
      code: 'CONFLICT',
    });
  });
});

describe('NotFoundError', () => {
  it('builds message without identifier', () => {
    const err = new NotFoundError();
    expect(err.message).toBe('Resource not found');
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('NOT_FOUND');
    expect(err.context).toEqual({ resource: 'Resource', identifier: undefined });
  });

  it('builds message with identifier', () => {
    const err = new NotFoundError('Robot', 'r-1');
    expect(err.message).toBe("Robot 'r-1' not found");
    expect(err.context).toMatchObject({ resource: 'Robot', identifier: 'r-1' });
  });

  it('merges extra context', () => {
    const err = new NotFoundError('Robot', 'r-1', { tenantId: 't-1' });
    expect(err.context).toEqual({ resource: 'Robot', identifier: 'r-1', tenantId: 't-1' });
  });
});

describe('ValidationError', () => {
  it('stores errors and exposes them in context and via field', () => {
    const errors = { email: ['required'], name: ['too short', 'invalid'] };
    const err = new ValidationError(errors);
    expect(err.message).toBe('Validation failed');
    expect(err.statusCode).toBe(422);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.errors).toEqual(errors);
    expect(err.context).toEqual({ errors });
  });

  it('toJSON merges base output with errors', () => {
    const errors = { email: ['required'] };
    const err = new ValidationError(errors, 'bad data');
    expect(err.toJSON()).toEqual({
      name: 'ValidationError',
      message: 'bad data',
      code: 'VALIDATION_ERROR',
      statusCode: 422,
      context: { errors },
      errors,
    });
  });
});

describe('RateLimitError', () => {
  it('default without retryAfter', () => {
    const err = new RateLimitError();
    expect(err.message).toBe('Rate limit exceeded');
    expect(err.statusCode).toBe(429);
    expect(err.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(err.retryAfter).toBeUndefined();
    expect(err.context).toEqual({ retryAfter: undefined });
  });

  it('with retryAfter', () => {
    const err = new RateLimitError('slow down', 30);
    expect(err.retryAfter).toBe(30);
    expect(err.context).toEqual({ retryAfter: 30 });
  });
});

describe('server error subclasses', () => {
  it('InternalError', () => {
    expect(new InternalError()).toMatchObject({
      message: 'Internal server error',
      statusCode: 500,
      code: 'INTERNAL_ERROR',
    });
  });

  it('GatewayError includes service in context', () => {
    const err = new GatewayError('vla', 'down', { attempt: 2 });
    expect(err.statusCode).toBe(502);
    expect(err.code).toBe('GATEWAY_ERROR');
    expect(err.message).toBe('down');
    expect(err.context).toEqual({ service: 'vla', attempt: 2 });
  });

  it('GatewayError default message', () => {
    expect(new GatewayError('vla').message).toBe('Upstream service error');
  });

  it('ServiceUnavailableError', () => {
    expect(new ServiceUnavailableError()).toMatchObject({
      message: 'Service temporarily unavailable',
      statusCode: 503,
      code: 'SERVICE_UNAVAILABLE',
    });
  });

  it('TimeoutError builds message and context', () => {
    const err = new TimeoutError('vla', 5000, { region: 'eu' });
    expect(err.message).toBe('vla timed out after 5000ms');
    expect(err.statusCode).toBe(504);
    expect(err.code).toBe('TIMEOUT');
    expect(err.context).toEqual({ service: 'vla', timeoutMs: 5000, region: 'eu' });
  });
});

describe('domain-specific errors', () => {
  it('RobotError defaults', () => {
    const err = new RobotError('r-1', 'fail');
    expect(err.message).toBe('fail');
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('ROBOT_ERROR');
    expect(err.context).toEqual({ robotId: 'r-1' });
  });

  it('RobotError with overrides and extra context', () => {
    const err = new RobotError('r-1', 'fail', 'CUSTOM', 500, { extra: true });
    expect(err.code).toBe('CUSTOM');
    expect(err.statusCode).toBe(500);
    expect(err.context).toEqual({ robotId: 'r-1', extra: true });
  });

  it('RobotOfflineError', () => {
    const err = new RobotOfflineError('r-1');
    expect(err).toBeInstanceOf(RobotError);
    expect(err.message).toBe("Robot 'r-1' is offline");
    expect(err.statusCode).toBe(503);
    expect(err.code).toBe('ROBOT_OFFLINE');
    expect(err.context).toEqual({ robotId: 'r-1' });
  });

  it('RobotCommandError', () => {
    const err = new RobotCommandError('r-1', 'move', 'collision');
    expect(err).toBeInstanceOf(RobotError);
    expect(err.message).toBe("Command 'move' failed: collision");
    expect(err.statusCode).toBe(422);
    expect(err.code).toBe('ROBOT_COMMAND_FAILED');
    expect(err.context).toEqual({ robotId: 'r-1', command: 'move', reason: 'collision' });
  });

  it('ProcessError defaults', () => {
    const err = new ProcessError('p-1', 'bad');
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('PROCESS_ERROR');
    expect(err.context).toEqual({ processId: 'p-1' });
  });

  it('ProcessStateError', () => {
    const err = new ProcessStateError('p-1', 'running', 'start');
    expect(err).toBeInstanceOf(ProcessError);
    expect(err.message).toBe("Cannot start process in 'running' state");
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe('INVALID_PROCESS_STATE');
    expect(err.context).toEqual({ processId: 'p-1', currentState: 'running', action: 'start' });
  });
});

describe('isOperationalError', () => {
  it('returns true for AppError instances', () => {
    expect(isOperationalError(new AppError('x'))).toBe(true);
    expect(isOperationalError(new NotFoundError())).toBe(true);
  });

  it('returns false for plain Error and non-errors', () => {
    expect(isOperationalError(new Error('x'))).toBe(false);
    expect(isOperationalError('string')).toBe(false);
    expect(isOperationalError(null)).toBe(false);
    expect(isOperationalError(undefined)).toBe(false);
    expect(isOperationalError({ isOperational: true })).toBe(false);
  });
});

describe('wrapError', () => {
  it('returns the same instance for AppError', () => {
    const original = new BadRequestError('x');
    expect(wrapError(original)).toBe(original);
  });

  it('wraps a plain Error preserving its message', () => {
    const wrapped = wrapError(new Error('low level'));
    expect(wrapped).toBeInstanceOf(InternalError);
    expect(wrapped.message).toBe('low level');
  });

  it('uses fallback message for non-Error values', () => {
    const wrapped = wrapError('weird');
    expect(wrapped).toBeInstanceOf(InternalError);
    expect(wrapped.message).toBe('An error occurred');
  });

  it('uses custom fallback message', () => {
    const wrapped = wrapError(42, 'custom fallback');
    expect(wrapped.message).toBe('custom fallback');
  });
});

describe('errorResponse', () => {
  it('omits details when context is absent', () => {
    const err = new AppError('msg', 400, 'CODE');
    expect(errorResponse(err)).toEqual({
      error: { code: 'CODE', message: 'msg' },
    });
  });

  it('includes details when context is present', () => {
    const err = new NotFoundError('Robot', 'r-1');
    expect(errorResponse(err)).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: "Robot 'r-1' not found",
        details: { resource: 'Robot', identifier: 'r-1' },
      },
    });
  });
});
