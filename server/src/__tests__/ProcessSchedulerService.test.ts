/**
 * @file ProcessSchedulerService.test.ts
 * @description Tests for the cron-driven process scheduler added by TASK-143.
 * @feature processes
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProcessSchedulerService } from '../services/ProcessSchedulerService.js';

describe('ProcessSchedulerService', () => {
  describe('validateCron', () => {
    it('accepts a standard 5-field cron expression and returns nextRun', () => {
      const result = ProcessSchedulerService.validateCron('*/5 * * * *');
      expect(result.valid).toBe(true);
      expect(result.nextRun).toBeDefined();
      expect(new Date(result.nextRun!).getTime()).toBeGreaterThan(Date.now());
    });

    it('accepts a daily cron', () => {
      const result = ProcessSchedulerService.validateCron('0 8 * * 1-5');
      expect(result.valid).toBe(true);
    });

    it('rejects gibberish', () => {
      const result = ProcessSchedulerService.validateCron('not a cron');
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('rejects out-of-range values', () => {
      const result = ProcessSchedulerService.validateCron('* * * * 9'); // weekday 9 invalid
      expect(result.valid).toBe(false);
    });
  });

  describe('start/stop', () => {
    it('is idempotent on start', () => {
      const svc = ProcessSchedulerService.getInstance();
      // Should not throw if started twice
      svc.start();
      svc.start();
      svc.stop();
    });

    it('stop is safe even if never started', () => {
      const svc = ProcessSchedulerService.getInstance();
      svc.stop();
      svc.stop();
    });
  });

  describe('tick', () => {
    it('does not throw when there are no schedulable definitions', async () => {
      const svc = ProcessSchedulerService.getInstance();
      // tick is exposed as public for deterministic testing
      await expect(svc.tick(new Date())).resolves.toBeUndefined();
    });
  });
});
