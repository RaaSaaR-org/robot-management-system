/**
 * @file backgroundTask.test.ts
 * @description runInBackground logs and survives a failure in work nobody awaits (TASK-433).
 * @feature core
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  FAILURE_LOG_WINDOW_MS,
  resetBackgroundFailureLogs,
  runInBackground,
} from '../backgroundTask.js';

/** What Prisma raises when the database does not answer in time. */
function socketTimeout(): Error {
  return Object.assign(
    new Error('Socket timeout (the database failed to respond to a query within the configured timeout)'),
    { name: 'PrismaClientKnownRequestError', code: 'P1008' }
  );
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetBackgroundFailureLogs();
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
  vi.useRealTimers();
});

describe('runInBackground', () => {
  it('logs a rejection with its error and does not let it escape', async () => {
    const err = socketTimeout();
    runInBackground('[Job] tick failed:', () => Promise.reject(err));
    await Promise.resolve();
    await Promise.resolve();
    // Vitest fails the run on an unhandled rejection, so reaching the end of
    // the run with the error logged is the whole assertion.
    expect(errorSpy).toHaveBeenCalledWith('[Job] tick failed:', err);
  });

  it('logs a synchronous throw instead of throwing into the timer', () => {
    const err = new Error('boom');
    expect(() =>
      runInBackground('[Job] tick failed:', () => {
        throw err;
      })
    ).not.toThrow();
    expect(errorSpy).toHaveBeenCalledWith('[Job] tick failed:', err);
  });

  it('says nothing when the task succeeds, sync or async', async () => {
    runInBackground('[Job] tick failed:', () => 42);
    runInBackground('[Job] tick failed:', async () => {});
    await Promise.resolve();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('runs every tick of a failing interval and keeps the timer alive', async () => {
    vi.useFakeTimers();
    const task = vi.fn().mockRejectedValue(socketTimeout());
    const timer = setInterval(() => runInBackground('[Job] tick failed:', task), 500);
    try {
      await vi.advanceTimersByTimeAsync(5_000);
      expect(task).toHaveBeenCalledTimes(10);
    } finally {
      clearInterval(timer);
    }
  });

  it('logs a job that keeps failing once per window, then reports what it left out', async () => {
    vi.useFakeTimers();
    const task = vi.fn().mockRejectedValue(socketTimeout());
    const timer = setInterval(() => runInBackground('[Job] tick failed:', task), 500);
    try {
      // 500 ms … 30 000 ms: 60 failures, the first one logged.
      await vi.advanceTimersByTimeAsync(FAILURE_LOG_WINDOW_MS);
      expect(task).toHaveBeenCalledTimes(60);
      expect(errorSpy).toHaveBeenCalledTimes(1);

      // The window has passed: the next failure is logged again, with the count.
      await vi.advanceTimersByTimeAsync(500);
      expect(errorSpy).toHaveBeenCalledTimes(2);
      expect(errorSpy.mock.calls[1][2]).toContain('59 more failure(s)');
    } finally {
      clearInterval(timer);
    }
  });

  it('rate-limits each job on its own', async () => {
    runInBackground('[A] failed:', () => Promise.reject(new Error('a')));
    runInBackground('[B] failed:', () => Promise.reject(new Error('b')));
    await Promise.resolve();
    await Promise.resolve();
    expect(errorSpy).toHaveBeenCalledTimes(2);
  });

  it('survives a console that throws', async () => {
    errorSpy.mockImplementation(() => {
      throw new Error('EPIPE');
    });
    expect(() =>
      runInBackground('[Job] tick failed:', () => {
        throw new Error('boom');
      })
    ).not.toThrow();
    runInBackground('[Job2] tick failed:', () => Promise.reject(new Error('boom')));
    await Promise.resolve();
    await Promise.resolve();
  });
});
