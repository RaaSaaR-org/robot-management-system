/**
 * @file processHandlers.test.ts
 * @description The process-level handlers log what nothing else caught, and
 *   exit only where the policy says so (TASK-433).
 * @feature core
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  exitsOnUnhandledRejection,
  handleUncaughtException,
  handleUnhandledRejection,
  registerProcessHandlers,
} from '../processHandlers.js';
import { logger } from '../logger.js';

let exitSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
let loggerErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  loggerErrorSpy = vi.spyOn(logger, 'error');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('handleUnhandledRejection', () => {
  it('in dev logs the reason with its stack and does not exit', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('UNHANDLED_REJECTION_EXIT', '');
    const reason = new Error('Socket timeout');

    handleUnhandledRejection(reason);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [prefix, detail] = errorSpy.mock.calls[0];
    expect(prefix).toContain('Unhandled promise rejection');
    expect(detail).toBe(reason.stack);
    expect(loggerErrorSpy).toHaveBeenCalledWith({ err: reason }, 'Unhandled promise rejection');
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('in production logs, then exits with code 1', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('UNHANDLED_REJECTION_EXIT', '');
    const reason = new Error('Socket timeout');

    handleUnhandledRejection(reason);

    expect(errorSpy.mock.calls[0][1]).toBe(reason.stack);
    expect(exitSpy).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(1);
    // Logged before the exit, not after.
    expect(errorSpy.mock.invocationCallOrder[0]).toBeLessThan(exitSpy.mock.invocationCallOrder[0]);
  });

  it('logs a reason that is not an Error', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('UNHANDLED_REJECTION_EXIT', '');
    handleUnhandledRejection({ code: 'P1008' });
    handleUnhandledRejection('plain string');
    handleUnhandledRejection(undefined);
    expect(errorSpy.mock.calls[0][1]).toBe('{"code":"P1008"}');
    expect(errorSpy.mock.calls[1][1]).toBe('plain string');
    expect(errorSpy).toHaveBeenCalledTimes(3);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('UNHANDLED_REJECTION_EXIT=false keeps a production process running', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('UNHANDLED_REJECTION_EXIT', 'false');
    handleUnhandledRejection(new Error('Socket timeout'));
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('UNHANDLED_REJECTION_EXIT=true makes dev exit too', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('UNHANDLED_REJECTION_EXIT', 'true');
    handleUnhandledRejection(new Error('Socket timeout'));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe('exitsOnUnhandledRejection', () => {
  it('follows NODE_ENV unless overridden; an unknown override is ignored', () => {
    expect(exitsOnUnhandledRejection({ NODE_ENV: 'production' })).toBe(true);
    expect(exitsOnUnhandledRejection({ NODE_ENV: 'development' })).toBe(false);
    expect(exitsOnUnhandledRejection({ NODE_ENV: 'test' })).toBe(false);
    expect(exitsOnUnhandledRejection({})).toBe(false);
    expect(exitsOnUnhandledRejection({ NODE_ENV: 'production', UNHANDLED_REJECTION_EXIT: '0' })).toBe(false);
    expect(exitsOnUnhandledRejection({ NODE_ENV: 'production', UNHANDLED_REJECTION_EXIT: ' False ' })).toBe(false);
    expect(exitsOnUnhandledRejection({ UNHANDLED_REJECTION_EXIT: '1' })).toBe(true);
    expect(exitsOnUnhandledRejection({ NODE_ENV: 'production', UNHANDLED_REJECTION_EXIT: 'maybe' })).toBe(true);
  });
});

describe('handleUncaughtException', () => {
  it('logs and exits with code 1 in every environment', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('UNHANDLED_REJECTION_EXIT', 'false');
    const err = new Error('boom');

    handleUncaughtException(err, 'uncaughtException');

    expect(errorSpy.mock.calls[0][0]).toContain('Uncaught exception');
    expect(errorSpy.mock.calls[0][1]).toBe(err.stack);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe('registerProcessHandlers', () => {
  it('registers each handler once, however often it is called', () => {
    const before = {
      rejection: process.listenerCount('unhandledRejection'),
      exception: process.listenerCount('uncaughtException'),
    };
    try {
      registerProcessHandlers();
      registerProcessHandlers();
      expect(process.listeners('unhandledRejection')).toContain(handleUnhandledRejection);
      expect(process.listeners('uncaughtException')).toContain(handleUncaughtException);
      expect(process.listenerCount('unhandledRejection')).toBe(before.rejection + 1);
      expect(process.listenerCount('uncaughtException')).toBe(before.exception + 1);
    } finally {
      process.off('unhandledRejection', handleUnhandledRejection);
      process.off('uncaughtException', handleUncaughtException);
    }
  });
});
