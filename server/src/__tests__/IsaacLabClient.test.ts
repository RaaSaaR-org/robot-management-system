/**
 * @file IsaacLabClient.test.ts
 * @description Unit tests for IsaacLabClient — mock mode, circuit breaker, job lifecycle
 * @feature simulation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  IsaacLabClient,
  CircuitBreaker,
  CircuitOpenError,
  type IsaacLabJobConfig,
} from '../services/IsaacLabClient.js';

// ============================================================================
// HELPERS
// ============================================================================

function makeConfig(overrides?: Partial<IsaacLabJobConfig>): IsaacLabJobConfig {
  return {
    sceneType: 'manipulation',
    objectCount: 10,
    episodeCount: 100,
    renderQuality: 'medium',
    randomizationLevel: 'low',
    modalities: ['rgb', 'depth'],
    ...overrides,
  };
}

function createMockClient(): IsaacLabClient {
  return new IsaacLabClient({ mockMode: true });
}

// ============================================================================
// MOCK MODE — JOB LIFECYCLE
// ============================================================================

describe('IsaacLabClient (mock mode)', () => {
  let client: IsaacLabClient;

  beforeEach(() => {
    client = createMockClient();
  });

  afterEach(() => {
    client.clearMockState();
  });

  it('should report mock mode enabled', () => {
    expect(client.isMockMode()).toBe(true);
  });

  // --------------------------------------------------------------------------
  // submitJob
  // --------------------------------------------------------------------------

  it('should submit a job with status queued', async () => {
    const config = makeConfig();
    const job = await client.submitJob('ds-001', config);

    expect(job.jobId).toBeDefined();
    expect(job.status).toBe('queued');
    expect(job.datasetId).toBe('ds-001');
    expect(job.config).toEqual(config);
    expect(job.progress).toBe(0);
    expect(job.createdAt).toBeInstanceOf(Date);
    expect(job.updatedAt).toBeInstanceOf(Date);
  });

  it('should assign unique IDs to different jobs', async () => {
    const config = makeConfig();
    const job1 = await client.submitJob('ds-001', config);
    const job2 = await client.submitJob('ds-002', config);

    expect(job1.jobId).not.toBe(job2.jobId);
  });

  it('should transition job to running after 500ms', async () => {
    const config = makeConfig();
    const job = await client.submitJob('ds-001', config);

    // Wait for queued → running transition
    await new Promise((r) => setTimeout(r, 600));

    const status = await client.getJobStatus(job.jobId);
    expect(status.status).toBe('running');
    expect(status.progress).toBeGreaterThanOrEqual(10);
  });

  it('should transition job to completed after 2s', async () => {
    const config = makeConfig();
    const job = await client.submitJob('ds-001', config);

    // Wait for full lifecycle
    await new Promise((r) => setTimeout(r, 2100));

    const status = await client.getJobStatus(job.jobId);
    expect(status.status).toBe('completed');
    expect(status.progress).toBe(100);
    expect(status.outputUrl).toBeDefined();
  });

  it('should store config in submitted job', async () => {
    const config = makeConfig({ sceneType: 'locomotion', episodeCount: 500 });
    const job = await client.submitJob('ds-003', config);

    expect(job.config.sceneType).toBe('locomotion');
    expect(job.config.episodeCount).toBe(500);
  });

  // --------------------------------------------------------------------------
  // getJobStatus
  // --------------------------------------------------------------------------

  it('should return current job status', async () => {
    const config = makeConfig();
    const job = await client.submitJob('ds-001', config);

    const status = await client.getJobStatus(job.jobId);
    expect(status.jobId).toBe(job.jobId);
    expect(status.datasetId).toBe('ds-001');
  });

  it('should throw when getting status of non-existent job', async () => {
    await expect(client.getJobStatus('non-existent')).rejects.toThrow('not found');
  });

  it('should increment progress on each poll while running', async () => {
    const config = makeConfig();
    const job = await client.submitJob('ds-001', config);

    // Wait for running state
    await new Promise((r) => setTimeout(r, 600));

    const poll1 = await client.getJobStatus(job.jobId);
    const progress1 = poll1.progress ?? 0;

    const poll2 = await client.getJobStatus(job.jobId);
    const progress2 = poll2.progress ?? 0;

    expect(progress2).toBeGreaterThanOrEqual(progress1);
  });

  // --------------------------------------------------------------------------
  // cancelJob
  // --------------------------------------------------------------------------

  it('should cancel a queued job', async () => {
    const config = makeConfig();
    const job = await client.submitJob('ds-001', config);

    const cancelled = await client.cancelJob(job.jobId);
    expect(cancelled.status).toBe('cancelled');
  });

  it('should cancel a running job', async () => {
    const config = makeConfig();
    const job = await client.submitJob('ds-001', config);

    // Wait for running state
    await new Promise((r) => setTimeout(r, 600));

    const cancelled = await client.cancelJob(job.jobId);
    expect(cancelled.status).toBe('cancelled');
  });

  it('should throw when cancelling non-existent job', async () => {
    await expect(client.cancelJob('non-existent')).rejects.toThrow('not found');
  });

  it('should stop state transitions after cancellation', async () => {
    const config = makeConfig();
    const job = await client.submitJob('ds-001', config);

    await client.cancelJob(job.jobId);

    // Wait past the normal completion time
    await new Promise((r) => setTimeout(r, 2200));

    const status = await client.getJobStatus(job.jobId);
    expect(status.status).toBe('cancelled');
  });

  // --------------------------------------------------------------------------
  // getJobOutput
  // --------------------------------------------------------------------------

  it('should return output for completed job', async () => {
    const config = makeConfig();
    const job = await client.submitJob('ds-001', config);

    // Wait for completion
    await new Promise((r) => setTimeout(r, 2100));

    const output = await client.getJobOutput(job.jobId);
    expect(output.url).toBeDefined();
    expect(output.size).toBeGreaterThan(0);
    expect(output.format).toBe('tar.gz');
  });

  it('should throw when getting output for non-completed job', async () => {
    const config = makeConfig();
    const job = await client.submitJob('ds-001', config);

    await expect(client.getJobOutput(job.jobId)).rejects.toThrow('not completed');
  });

  it('should throw when getting output for non-existent job', async () => {
    await expect(client.getJobOutput('non-existent')).rejects.toThrow('not found');
  });

  // --------------------------------------------------------------------------
  // listJobs
  // --------------------------------------------------------------------------

  it('should list all jobs', async () => {
    const config = makeConfig();
    await client.submitJob('ds-001', config);
    await client.submitJob('ds-002', config);
    await client.submitJob('ds-003', config);

    const jobs = await client.listJobs();
    expect(jobs).toHaveLength(3);
  });

  it('should filter jobs by status', async () => {
    const config = makeConfig();
    const job1 = await client.submitJob('ds-001', config);
    await client.submitJob('ds-002', config);

    await client.cancelJob(job1.jobId);

    const cancelled = await client.listJobs({ status: 'cancelled' });
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0].jobId).toBe(job1.jobId);
  });

  it('should filter jobs by datasetId', async () => {
    const config = makeConfig();
    await client.submitJob('ds-001', config);
    await client.submitJob('ds-002', config);
    await client.submitJob('ds-001', config);

    const filtered = await client.listJobs({ datasetId: 'ds-001' });
    expect(filtered).toHaveLength(2);
    filtered.forEach((j) => expect(j.datasetId).toBe('ds-001'));
  });

  it('should return empty array when no jobs match filter', async () => {
    const config = makeConfig();
    await client.submitJob('ds-001', config);

    const jobs = await client.listJobs({ status: 'failed' });
    expect(jobs).toHaveLength(0);
  });

  it('should filter by both status and datasetId', async () => {
    const config = makeConfig();
    const job1 = await client.submitJob('ds-001', config);
    await client.submitJob('ds-002', config);
    await client.submitJob('ds-001', config);

    await client.cancelJob(job1.jobId);

    const filtered = await client.listJobs({ status: 'cancelled', datasetId: 'ds-001' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].jobId).toBe(job1.jobId);
  });

  // --------------------------------------------------------------------------
  // healthCheck
  // --------------------------------------------------------------------------

  it('should always return healthy in mock mode', async () => {
    const health = await client.healthCheck();
    expect(health.healthy).toBe(true);
    expect(health.latencyMs).toBeDefined();
  });

  // --------------------------------------------------------------------------
  // clearMockState
  // --------------------------------------------------------------------------

  it('should clear all jobs and timers on clearMockState', async () => {
    const config = makeConfig();
    await client.submitJob('ds-001', config);
    await client.submitJob('ds-002', config);

    client.clearMockState();

    const jobs = await client.listJobs();
    expect(jobs).toHaveLength(0);
  });
});

// ============================================================================
// CIRCUIT BREAKER
// ============================================================================

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker(5, 60_000, 30_000);
  });

  it('should start in closed state', () => {
    const state = breaker.getState();
    expect(state.state).toBe('closed');
    expect(state.failures).toBe(0);
    expect(state.lastFailure).toBeNull();
    expect(state.nextAttempt).toBeNull();
  });

  it('should allow requests in closed state', () => {
    expect(() => breaker.allowRequest()).not.toThrow();
  });

  it('should stay closed with fewer than maxFailures', () => {
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();

    const state = breaker.getState();
    expect(state.state).toBe('closed');
    expect(state.failures).toBe(4);
  });

  it('should open after maxFailures', () => {
    for (let i = 0; i < 5; i++) {
      breaker.recordFailure();
    }

    const state = breaker.getState();
    expect(state.state).toBe('open');
    expect(state.failures).toBe(5);
    expect(state.nextAttempt).not.toBeNull();
  });

  it('should throw CircuitOpenError when open', () => {
    for (let i = 0; i < 5; i++) {
      breaker.recordFailure();
    }

    expect(() => breaker.allowRequest()).toThrow(CircuitOpenError);
  });

  it('should transition to half-open after recovery time', () => {
    // Use short recovery for testing
    const shortBreaker = new CircuitBreaker(2, 60_000, 50);

    shortBreaker.recordFailure();
    shortBreaker.recordFailure();

    expect(shortBreaker.getState().state).toBe('open');

    // Fast-forward by manipulating time
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const state = shortBreaker.getState();
        expect(state.state).toBe('half-open');
        resolve();
      }, 60);
    });
  });

  it('should close on success in half-open state', async () => {
    const shortBreaker = new CircuitBreaker(2, 60_000, 50);

    shortBreaker.recordFailure();
    shortBreaker.recordFailure();

    // Wait for half-open
    await new Promise((r) => setTimeout(r, 60));

    expect(shortBreaker.getState().state).toBe('half-open');

    shortBreaker.recordSuccess();
    const state = shortBreaker.getState();
    expect(state.state).toBe('closed');
    expect(state.failures).toBe(0);
  });

  it('should reopen on failure in half-open state', async () => {
    const shortBreaker = new CircuitBreaker(2, 60_000, 50);

    shortBreaker.recordFailure();
    shortBreaker.recordFailure();

    // Wait for half-open
    await new Promise((r) => setTimeout(r, 60));

    expect(shortBreaker.getState().state).toBe('half-open');

    shortBreaker.recordFailure();
    expect(shortBreaker.getState().state).toBe('open');
  });

  it('should reset to initial state', () => {
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();

    breaker.reset();

    const state = breaker.getState();
    expect(state.state).toBe('closed');
    expect(state.failures).toBe(0);
    expect(state.lastFailure).toBeNull();
    expect(state.nextAttempt).toBeNull();
  });

  it('should reset failures on success in closed state', () => {
    breaker.recordFailure();
    breaker.recordFailure();

    breaker.recordSuccess();

    const state = breaker.getState();
    expect(state.failures).toBe(0);
  });

  it('should track lastFailure timestamp', () => {
    const before = new Date();
    breaker.recordFailure();
    const after = new Date();

    const state = breaker.getState();
    expect(state.lastFailure).not.toBeNull();
    expect(state.lastFailure!.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(state.lastFailure!.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});

// ============================================================================
// CIRCUIT BREAKER INTEGRATION WITH CLIENT
// ============================================================================

describe('IsaacLabClient (circuit breaker — non-mock)', () => {
  it('should have circuit breaker always closed in mock mode', () => {
    const client = createMockClient();
    const state = client.getCircuitBreakerState();
    expect(state.state).toBe('closed');
    client.clearMockState();
  });

  it('should expose circuit breaker state', () => {
    const cb = new CircuitBreaker(3, 60_000, 30_000);
    const client = new IsaacLabClient({ baseUrl: 'http://fake:9999', mockMode: false, circuitBreaker: cb });

    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();

    const state = client.getCircuitBreakerState();
    expect(state.state).toBe('open');
    expect(state.failures).toBe(3);
  });

  it('should reject requests when circuit is open (non-mock)', async () => {
    const cb = new CircuitBreaker(1, 60_000, 30_000);
    const client = new IsaacLabClient({ baseUrl: 'http://fake:9999', mockMode: false, circuitBreaker: cb });

    cb.recordFailure();

    await expect(client.submitJob('ds-001', makeConfig())).rejects.toThrow(CircuitOpenError);
    await expect(client.getJobStatus('job-001')).rejects.toThrow(CircuitOpenError);
    await expect(client.cancelJob('job-001')).rejects.toThrow(CircuitOpenError);
    await expect(client.listJobs()).rejects.toThrow(CircuitOpenError);
    await expect(client.getJobOutput('job-001')).rejects.toThrow(CircuitOpenError);
  });
});

// ============================================================================
// CONSTRUCTOR / SINGLETON
// ============================================================================

describe('IsaacLabClient (constructor)', () => {
  it('should default to mock mode when no URL is provided', () => {
    const original = process.env.ISAAC_LAB_URL;
    delete process.env.ISAAC_LAB_URL;

    const client = new IsaacLabClient();
    expect(client.isMockMode()).toBe(true);

    process.env.ISAAC_LAB_URL = original;
    client.clearMockState();
  });

  it('should respect explicit mockMode option', () => {
    const client = new IsaacLabClient({ baseUrl: 'http://fake:9999', mockMode: true });
    expect(client.isMockMode()).toBe(true);
    client.clearMockState();
  });
});
