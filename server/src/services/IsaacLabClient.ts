/**
 * @file IsaacLabClient.ts
 * @description HTTP client for Isaac Lab synthetic data generation service with circuit breaker and mock mode
 * @feature simulation
 */

import { v4 as uuidv4 } from 'uuid';
import { ServiceUnavailableError } from '../utils/errors.js';

// ============================================================================
// TYPES
// ============================================================================

export interface IsaacLabJobConfig {
  sceneType: string;
  objectCount: number;
  episodeCount: number;
  renderQuality: 'low' | 'medium' | 'high';
  randomizationLevel: 'none' | 'low' | 'high';
  modalities: string[];
}

export interface IsaacLabJob {
  jobId: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  datasetId: string;
  config: IsaacLabJobConfig;
  progress?: number;
  outputUrl?: string;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IsaacLabJobOutput {
  url: string;
  size: number;
  format: string;
}

export interface CircuitBreakerState {
  state: 'closed' | 'open' | 'half-open';
  failures: number;
  lastFailure: Date | null;
  nextAttempt: Date | null;
}

export interface IsaacLabHealthCheck {
  healthy: boolean;
  latencyMs: number;
}

export interface IsaacLabJobFilter {
  status?: IsaacLabJob['status'];
  datasetId?: string;
}

// ============================================================================
// CIRCUIT BREAKER ERROR
// ============================================================================

export class CircuitOpenError extends ServiceUnavailableError {
  constructor(nextAttempt: Date | null) {
    super(`Circuit breaker is open. Next attempt${nextAttempt ? ` at ${nextAttempt.toISOString()}` : ' not scheduled'}`);
  }
}

// ============================================================================
// CIRCUIT BREAKER
// ============================================================================

export class CircuitBreaker {
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  private failures = 0;
  private lastFailure: Date | null = null;
  private nextAttempt: Date | null = null;

  constructor(
    private readonly maxFailures: number = 5,
    private readonly windowMs: number = 60_000,
    private readonly recoveryMs: number = 30_000
  ) {}

  getState(): CircuitBreakerState {
    this.checkRecovery();
    return {
      state: this.state,
      failures: this.failures,
      lastFailure: this.lastFailure,
      nextAttempt: this.nextAttempt,
    };
  }

  /**
   * Check if a request is allowed. Throws CircuitOpenError if circuit is open.
   */
  allowRequest(): void {
    this.checkRecovery();

    if (this.state === 'open') {
      throw new CircuitOpenError(this.nextAttempt);
    }
    // 'closed' and 'half-open' allow requests
  }

  /**
   * Record a successful request
   */
  recordSuccess(): void {
    this.failures = 0;
    this.lastFailure = null;
    this.nextAttempt = null;
    this.state = 'closed';
  }

  /**
   * Record a failed request
   */
  recordFailure(): void {
    this.failures++;
    this.lastFailure = new Date();

    if (this.state === 'half-open') {
      // Failure during half-open → reopen
      this.state = 'open';
      this.nextAttempt = new Date(Date.now() + this.recoveryMs);
      return;
    }

    // Check if failures within window exceed threshold
    if (this.failures >= this.maxFailures) {
      this.state = 'open';
      this.nextAttempt = new Date(Date.now() + this.recoveryMs);
    }
  }

  /**
   * Reset the circuit breaker to initial state
   */
  reset(): void {
    this.state = 'closed';
    this.failures = 0;
    this.lastFailure = null;
    this.nextAttempt = null;
  }

  private checkRecovery(): void {
    if (this.state === 'open' && this.nextAttempt && Date.now() >= this.nextAttempt.getTime()) {
      this.state = 'half-open';
    }
  }
}

// ============================================================================
// ISAAC LAB CLIENT
// ============================================================================

export class IsaacLabClient {
  private static instance: IsaacLabClient;

  private readonly baseUrl: string | null;
  private readonly mockMode: boolean;
  private readonly circuitBreaker: CircuitBreaker;

  /** In-memory job store for mock mode */
  private mockJobs: Map<string, IsaacLabJob> = new Map();

  /** Active mock timers (for cleanup) */
  private mockTimers: Map<string, NodeJS.Timeout[]> = new Map();

  constructor(options?: {
    baseUrl?: string;
    mockMode?: boolean;
    circuitBreaker?: CircuitBreaker;
  }) {
    this.baseUrl = options?.baseUrl ?? process.env.ISAAC_LAB_URL ?? null;
    this.mockMode = options?.mockMode ?? (process.env.ISAAC_LAB_MOCK === 'true' || !this.baseUrl);
    this.circuitBreaker = options?.circuitBreaker ?? new CircuitBreaker();

    if (this.mockMode) {
      console.log('[IsaacLabClient] Running in mock mode');
    } else {
      console.log(`[IsaacLabClient] Connecting to ${this.baseUrl}`);
    }
  }

  /**
   * Get singleton instance
   */
  static getInstance(): IsaacLabClient {
    if (!IsaacLabClient.instance) {
      IsaacLabClient.instance = new IsaacLabClient();
    }
    return IsaacLabClient.instance;
  }

  /**
   * Check if running in mock mode
   */
  isMockMode(): boolean {
    return this.mockMode;
  }

  // ============================================================================
  // JOB OPERATIONS
  // ============================================================================

  /**
   * Submit a new synthetic data generation job
   */
  async submitJob(datasetId: string, config: IsaacLabJobConfig): Promise<IsaacLabJob> {
    if (this.mockMode) {
      return this.mockSubmitJob(datasetId, config);
    }

    this.circuitBreaker.allowRequest();

    try {
      const response = await fetch(`${this.baseUrl}/api/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ datasetId, config }),
      });

      if (!response.ok) {
        throw new Error(`Isaac Lab API error: ${response.status} ${response.statusText}`);
      }

      this.circuitBreaker.recordSuccess();
      return await response.json() as IsaacLabJob;
    } catch (error) {
      if (error instanceof CircuitOpenError) throw error;
      this.circuitBreaker.recordFailure();
      throw error;
    }
  }

  /**
   * Get the status and progress of a job
   */
  async getJobStatus(jobId: string): Promise<IsaacLabJob> {
    if (this.mockMode) {
      return this.mockGetJobStatus(jobId);
    }

    this.circuitBreaker.allowRequest();

    try {
      const response = await fetch(`${this.baseUrl}/api/jobs/${jobId}`);

      if (!response.ok) {
        throw new Error(`Isaac Lab API error: ${response.status} ${response.statusText}`);
      }

      this.circuitBreaker.recordSuccess();
      return await response.json() as IsaacLabJob;
    } catch (error) {
      if (error instanceof CircuitOpenError) throw error;
      this.circuitBreaker.recordFailure();
      throw error;
    }
  }

  /**
   * Cancel a running job
   */
  async cancelJob(jobId: string): Promise<IsaacLabJob> {
    if (this.mockMode) {
      return this.mockCancelJob(jobId);
    }

    this.circuitBreaker.allowRequest();

    try {
      const response = await fetch(`${this.baseUrl}/api/jobs/${jobId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error(`Isaac Lab API error: ${response.status} ${response.statusText}`);
      }

      this.circuitBreaker.recordSuccess();
      return await response.json() as IsaacLabJob;
    } catch (error) {
      if (error instanceof CircuitOpenError) throw error;
      this.circuitBreaker.recordFailure();
      throw error;
    }
  }

  /**
   * Get the output URL and metadata for a completed job
   */
  async getJobOutput(jobId: string): Promise<IsaacLabJobOutput> {
    if (this.mockMode) {
      return this.mockGetJobOutput(jobId);
    }

    this.circuitBreaker.allowRequest();

    try {
      const response = await fetch(`${this.baseUrl}/api/jobs/${jobId}/output`);

      if (!response.ok) {
        throw new Error(`Isaac Lab API error: ${response.status} ${response.statusText}`);
      }

      this.circuitBreaker.recordSuccess();
      return await response.json() as IsaacLabJobOutput;
    } catch (error) {
      if (error instanceof CircuitOpenError) throw error;
      this.circuitBreaker.recordFailure();
      throw error;
    }
  }

  /**
   * List jobs with optional filtering
   */
  async listJobs(filter?: IsaacLabJobFilter): Promise<IsaacLabJob[]> {
    if (this.mockMode) {
      return this.mockListJobs(filter);
    }

    this.circuitBreaker.allowRequest();

    try {
      const params = new URLSearchParams();
      if (filter?.status) params.set('status', filter.status);
      if (filter?.datasetId) params.set('datasetId', filter.datasetId);

      const url = `${this.baseUrl}/api/jobs${params.toString() ? `?${params.toString()}` : ''}`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Isaac Lab API error: ${response.status} ${response.statusText}`);
      }

      this.circuitBreaker.recordSuccess();
      return await response.json() as IsaacLabJob[];
    } catch (error) {
      if (error instanceof CircuitOpenError) throw error;
      this.circuitBreaker.recordFailure();
      throw error;
    }
  }

  // ============================================================================
  // HEALTH & CIRCUIT BREAKER
  // ============================================================================

  /**
   * Get the current circuit breaker state
   */
  getCircuitBreakerState(): CircuitBreakerState {
    return this.circuitBreaker.getState();
  }

  /**
   * Health check against Isaac Lab service
   */
  async healthCheck(): Promise<IsaacLabHealthCheck> {
    if (this.mockMode) {
      return { healthy: true, latencyMs: 1 };
    }

    const start = Date.now();

    try {
      this.circuitBreaker.allowRequest();

      const response = await fetch(`${this.baseUrl}/health`);
      const latencyMs = Date.now() - start;

      if (!response.ok) {
        this.circuitBreaker.recordFailure();
        return { healthy: false, latencyMs };
      }

      this.circuitBreaker.recordSuccess();
      return { healthy: true, latencyMs };
    } catch (error) {
      const latencyMs = Date.now() - start;
      if (!(error instanceof CircuitOpenError)) {
        this.circuitBreaker.recordFailure();
      }
      return { healthy: false, latencyMs };
    }
  }

  // ============================================================================
  // MOCK IMPLEMENTATIONS
  // ============================================================================

  private mockSubmitJob(datasetId: string, config: IsaacLabJobConfig): IsaacLabJob {
    const now = new Date();
    const jobId = uuidv4();
    const job: IsaacLabJob = {
      jobId,
      status: 'queued',
      datasetId,
      config,
      progress: 0,
      createdAt: now,
      updatedAt: now,
    };

    this.mockJobs.set(jobId, job);

    // Simulate async state transitions
    const timers: NodeJS.Timeout[] = [];

    timers.push(setTimeout(() => {
      const j = this.mockJobs.get(jobId);
      if (j && j.status === 'queued') {
        j.status = 'running';
        j.progress = 10;
        j.updatedAt = new Date();
      }
    }, 500));

    timers.push(setTimeout(() => {
      const j = this.mockJobs.get(jobId);
      if (j && j.status === 'running') {
        j.status = 'completed';
        j.progress = 100;
        j.outputUrl = `mock://datasets/${datasetId}/output/${jobId}.tar.gz`;
        j.updatedAt = new Date();
      }
    }, 2000));

    this.mockTimers.set(jobId, timers);

    return { ...job };
  }

  private mockGetJobStatus(jobId: string): IsaacLabJob {
    const job = this.mockJobs.get(jobId);
    if (!job) {
      throw new Error(`Job '${jobId}' not found`);
    }

    // Simulate progress increment on poll (if running)
    if (job.status === 'running' && job.progress !== undefined && job.progress < 90) {
      job.progress = Math.min(job.progress + 10, 90);
      job.updatedAt = new Date();
    }

    return { ...job };
  }

  private mockCancelJob(jobId: string): IsaacLabJob {
    const job = this.mockJobs.get(jobId);
    if (!job) {
      throw new Error(`Job '${jobId}' not found`);
    }

    // Clear pending timers
    const timers = this.mockTimers.get(jobId);
    if (timers) {
      timers.forEach(clearTimeout);
      this.mockTimers.delete(jobId);
    }

    job.status = 'cancelled';
    job.updatedAt = new Date();

    return { ...job };
  }

  private mockGetJobOutput(jobId: string): IsaacLabJobOutput {
    const job = this.mockJobs.get(jobId);
    if (!job) {
      throw new Error(`Job '${jobId}' not found`);
    }

    if (job.status !== 'completed') {
      throw new Error(`Job '${jobId}' is not completed (status: ${job.status})`);
    }

    return {
      url: job.outputUrl ?? `mock://datasets/${job.datasetId}/output/${jobId}.tar.gz`,
      size: 1024 * 1024 * 50, // 50MB mock
      format: 'tar.gz',
    };
  }

  private mockListJobs(filter?: IsaacLabJobFilter): IsaacLabJob[] {
    let jobs = Array.from(this.mockJobs.values());

    if (filter?.status) {
      jobs = jobs.filter((j) => j.status === filter.status);
    }
    if (filter?.datasetId) {
      jobs = jobs.filter((j) => j.datasetId === filter.datasetId);
    }

    return jobs.map((j) => ({ ...j }));
  }

  // ============================================================================
  // CLEANUP
  // ============================================================================

  /**
   * Clear all mock jobs and timers (for testing)
   */
  clearMockState(): void {
    this.mockTimers.forEach((timers) => timers.forEach(clearTimeout));
    this.mockTimers.clear();
    this.mockJobs.clear();
    this.circuitBreaker.reset();
  }
}

// Singleton export
export const isaacLabClient = IsaacLabClient.getInstance();
