/**
 * @file safety.test.ts
 * @description Tests for VLASafetyStatus type shape and API response mapping.
 * @feature vla
 */

import { describe, it, expect } from 'vitest';
import type { VLASafetyStatus } from '../types.js';

describe('VLASafetyStatus', () => {
  it('should accept a valid safety status object', () => {
    const status: VLASafetyStatus = {
      validatorEnabled: true,
      rateLimiterEnabled: true,
      watchdogHealthy: true,
      lastLatencyMs: 45.2,
      actionsValidated: 1250,
      actionsRejected: 3,
      actionsClipped: 12,
      rateLimiterMaxDelta: 10.0,
      watchdogTimeoutMs: 100.0,
      degradationEvents: [],
    };

    expect(status.validatorEnabled).toBe(true);
    expect(status.rateLimiterEnabled).toBe(true);
    expect(status.watchdogHealthy).toBe(true);
    expect(status.lastLatencyMs).toBe(45.2);
    expect(status.actionsValidated).toBe(1250);
    expect(status.actionsRejected).toBe(3);
    expect(status.actionsClipped).toBe(12);
    expect(status.rateLimiterMaxDelta).toBe(10.0);
    expect(status.watchdogTimeoutMs).toBe(100.0);
    expect(status.degradationEvents).toEqual([]);
  });

  it('should accept null latency when no measurements exist', () => {
    const status: VLASafetyStatus = {
      validatorEnabled: true,
      rateLimiterEnabled: true,
      watchdogHealthy: true,
      lastLatencyMs: null,
      actionsValidated: 0,
      actionsRejected: 0,
      actionsClipped: 0,
      rateLimiterMaxDelta: 10.0,
      watchdogTimeoutMs: 100.0,
      degradationEvents: [],
    };

    expect(status.lastLatencyMs).toBeNull();
  });

  it('should accept degradation events', () => {
    const status: VLASafetyStatus = {
      validatorEnabled: true,
      rateLimiterEnabled: true,
      watchdogHealthy: false,
      lastLatencyMs: 250.0,
      actionsValidated: 500,
      actionsRejected: 10,
      actionsClipped: 25,
      rateLimiterMaxDelta: 10.0,
      watchdogTimeoutMs: 100.0,
      degradationEvents: [
        {
          type: 'safe_stop',
          reason: 'Network watchdog timeout exceeded',
          timestamp: 1709000000.0,
        },
      ],
    };

    expect(status.degradationEvents).toHaveLength(1);
    expect(status.degradationEvents[0].type).toBe('safe_stop');
    expect(status.degradationEvents[0].reason).toContain('watchdog');
  });

  it('should map sidecar JSON response to VLASafetyStatus', () => {
    // Simulate the snake_case → camelCase mapping from state.ts
    const sidecarResponse = {
      validator_enabled: true,
      rate_limiter_enabled: true,
      watchdog_healthy: true,
      last_watchdog_latency_ms: 42.0,
      actions_validated: 100,
      actions_rejected: 2,
      actions_clipped: 5,
      rate_limiter_max_delta: 10.0,
      watchdog_timeout_ms: 100.0,
      degradation_events: [],
    };

    const mapped: VLASafetyStatus = {
      validatorEnabled: sidecarResponse.validator_enabled,
      rateLimiterEnabled: sidecarResponse.rate_limiter_enabled,
      watchdogHealthy: sidecarResponse.watchdog_healthy,
      lastLatencyMs: sidecarResponse.last_watchdog_latency_ms,
      actionsValidated: sidecarResponse.actions_validated,
      actionsRejected: sidecarResponse.actions_rejected,
      actionsClipped: sidecarResponse.actions_clipped,
      rateLimiterMaxDelta: sidecarResponse.rate_limiter_max_delta,
      watchdogTimeoutMs: sidecarResponse.watchdog_timeout_ms,
      degradationEvents: sidecarResponse.degradation_events,
    };

    expect(mapped.validatorEnabled).toBe(true);
    expect(mapped.lastLatencyMs).toBe(42.0);
    expect(mapped.actionsValidated).toBe(100);
  });
});
