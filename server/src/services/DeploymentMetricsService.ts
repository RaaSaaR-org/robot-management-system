/**
 * @file DeploymentMetricsService.ts
 * @description Service for collecting and monitoring deployment metrics
 * @feature vla
 */

import { EventEmitter } from 'events';
import { robotManager } from './RobotManager.js';
import { deploymentRepository } from '../repositories/index.js';
import { HttpClient, HTTP_TIMEOUTS } from './HttpClient.js';
import type { Deployment, RollbackThresholds } from '../types/vla.types.js';
import type {
  DeploymentMetricSample,
  MetricWindow,
  AggregatedDeploymentMetrics,
  RobotMetricsSummary,
  RobotVLAMetrics,
  ThresholdCheckResult,
  ThresholdViolation,
} from '../types/deployment.types.js';
import {
  METRICS_POLL_INTERVAL_MS,
  THRESHOLD_CHECK_INTERVAL_MS,
} from '../types/deployment.types.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

const METRIC_WINDOW_DURATION_MS = 60 * 60 * 1000; // 1 hour rolling window
const MAX_SAMPLES_PER_ROBOT = 1000; // Max samples to keep per robot

// ============================================================================
// DEPLOYMENT METRICS SERVICE
// ============================================================================

/**
 * Service for collecting and monitoring VLA deployment metrics
 */
export class DeploymentMetricsService extends EventEmitter {
  private static instance: DeploymentMetricsService;

  // Metric windows per deployment
  private metricWindows: Map<string, MetricWindow> = new Map();

  // Monitoring intervals
  private pollIntervals: Map<string, NodeJS.Timeout> = new Map();
  private thresholdIntervals: Map<string, NodeJS.Timeout> = new Map();

  // Callback for threshold violations
  private thresholdViolationCallback?: (
    deploymentId: string,
    metrics: AggregatedDeploymentMetrics,
    result: ThresholdCheckResult
  ) => Promise<void>;

  private constructor() {
    super();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): DeploymentMetricsService {
    if (!DeploymentMetricsService.instance) {
      DeploymentMetricsService.instance = new DeploymentMetricsService();
    }
    return DeploymentMetricsService.instance;
  }

  /**
   * Set callback for threshold violations
   */
  setThresholdViolationCallback(
    callback: (
      deploymentId: string,
      metrics: AggregatedDeploymentMetrics,
      result: ThresholdCheckResult
    ) => Promise<void>
  ): void {
    this.thresholdViolationCallback = callback;
  }

  // ============================================================================
  // MONITORING LIFECYCLE
  // ============================================================================

  /**
   * Start monitoring metrics for a deployment
   */
  startMonitoring(deploymentId: string): void {
    if (this.pollIntervals.has(deploymentId)) {
      console.log(`[DeploymentMetricsService] Already monitoring: ${deploymentId}`);
      return;
    }

    // Initialize metric window
    this.metricWindows.set(deploymentId, {
      deploymentId,
      samples: [],
      windowDurationMs: METRIC_WINDOW_DURATION_MS,
      windowStartTime: Date.now(),
    });

    // Start polling interval
    const pollInterval = setInterval(async () => {
      await this.pollDeploymentMetrics(deploymentId);
    }, METRICS_POLL_INTERVAL_MS);
    this.pollIntervals.set(deploymentId, pollInterval);

    // Start threshold check interval
    const thresholdInterval = setInterval(async () => {
      await this.checkDeploymentThresholds(deploymentId);
    }, THRESHOLD_CHECK_INTERVAL_MS);
    this.thresholdIntervals.set(deploymentId, thresholdInterval);

    console.log(`[DeploymentMetricsService] Started monitoring: ${deploymentId}`);

    // Do initial poll
    this.pollDeploymentMetrics(deploymentId).catch(err => {
      console.error(`[DeploymentMetricsService] Initial poll failed:`, err);
    });
  }

  /**
   * Stop monitoring a deployment
   */
  stopMonitoring(deploymentId: string): void {
    // Clear poll interval
    const pollInterval = this.pollIntervals.get(deploymentId);
    if (pollInterval) {
      clearInterval(pollInterval);
      this.pollIntervals.delete(deploymentId);
    }

    // Clear threshold interval
    const thresholdInterval = this.thresholdIntervals.get(deploymentId);
    if (thresholdInterval) {
      clearInterval(thresholdInterval);
      this.thresholdIntervals.delete(deploymentId);
    }

    // Keep metric window for a while (for final reporting)
    // Will be cleaned up later

    console.log(`[DeploymentMetricsService] Stopped monitoring: ${deploymentId}`);
  }

  // ============================================================================
  // METRIC COLLECTION
  // ============================================================================

  /**
   * Poll metrics from all robots in a deployment
   */
  private async pollDeploymentMetrics(deploymentId: string): Promise<void> {
    const deployment = await deploymentRepository.findById(deploymentId);
    if (!deployment) {
      console.warn(`[DeploymentMetricsService] Deployment not found: ${deploymentId}`);
      return;
    }

    // Only poll deployed robots
    const robotIds = deployment.deployedRobotIds;
    if (robotIds.length === 0) {
      return;
    }

    // Poll each robot (in parallel with timeout)
    const pollPromises = robotIds.map(robotId =>
      this.fetchRobotMetrics(robotId, deploymentId).catch(err => {
        console.warn(`[DeploymentMetricsService] Failed to poll robot ${robotId}:`, err.message);
        return null;
      })
    );

    await Promise.all(pollPromises);
  }

  /**
   * Fetch VLA metrics from a robot agent
   */
  private async fetchRobotMetrics(
    robotId: string,
    deploymentId: string
  ): Promise<RobotVLAMetrics | null> {
    const registeredRobot = await robotManager.getRegisteredRobot(robotId);
    if (!registeredRobot) {
      return null;
    }

    try {
      const httpClient = new HttpClient(registeredRobot.baseUrl, HTTP_TIMEOUTS.SHORT);
      const response = await httpClient.get<{ metrics: RobotVLAMetrics }>(
        `/api/v1/robots/${robotId}/vla/metrics`
      );

      const metrics = response.metrics;
      if (metrics) {
        // Record sample
        this.recordMetric(deploymentId, {
          robotId,
          timestamp: Date.now(),
          inferenceLatencyMs: metrics.avgLatencyMs,
          errorCount: metrics.failedRequests,
          successCount: metrics.successfulRequests,
          taskFailures: metrics.taskFailures,
          taskSuccesses: metrics.taskSuccesses,
        });
        return metrics;
      }
    } catch (error) {
      // Polling failures are expected during network issues
      return null;
    }

    return null;
  }

  /**
   * Record a metric sample
   */
  recordMetric(deploymentId: string, sample: DeploymentMetricSample): void {
    const window = this.metricWindows.get(deploymentId);
    if (!window) {
      return;
    }

    window.samples.push(sample);

    // Prune old samples outside the window
    const cutoffTime = Date.now() - window.windowDurationMs;
    window.samples = window.samples.filter(s => s.timestamp >= cutoffTime);

    // Also limit total samples per robot
    const robotSamples = new Map<string, DeploymentMetricSample[]>();
    for (const s of window.samples) {
      const existing = robotSamples.get(s.robotId) ?? [];
      existing.push(s);
      robotSamples.set(s.robotId, existing);
    }

    // Keep only latest MAX_SAMPLES_PER_ROBOT per robot
    window.samples = [];
    for (const [, samples] of robotSamples) {
      const trimmed = samples.slice(-MAX_SAMPLES_PER_ROBOT);
      window.samples.push(...trimmed);
    }
  }

  // ============================================================================
  // METRIC AGGREGATION
  // ============================================================================

  /**
   * Get aggregated metrics for a deployment
   */
  getAggregatedMetrics(deploymentId: string): AggregatedDeploymentMetrics | null {
    const window = this.metricWindows.get(deploymentId);
    if (!window || window.samples.length === 0) {
      return null;
    }

    const now = Date.now();
    const cutoffTime = now - window.windowDurationMs;
    const recentSamples = window.samples.filter(s => s.timestamp >= cutoffTime);

    if (recentSamples.length === 0) {
      return null;
    }

    // Group samples by robot
    const robotSamples = new Map<string, DeploymentMetricSample[]>();
    for (const sample of recentSamples) {
      const existing = robotSamples.get(sample.robotId) ?? [];
      existing.push(sample);
      robotSamples.set(sample.robotId, existing);
    }

    // Calculate per-robot summaries
    const metricsPerRobot: Record<string, RobotMetricsSummary> = {};
    let totalSuccesses = 0;
    let totalErrors = 0;
    let totalTaskSuccesses = 0;
    let totalTaskFailures = 0;
    const allLatencies: number[] = [];

    for (const [robotId, samples] of robotSamples) {
      const latestSample = samples[samples.length - 1];
      const totalRequests = samples.reduce(
        (sum, s) => sum + s.successCount + s.errorCount,
        0
      );
      const errorCount = samples.reduce((sum, s) => sum + s.errorCount, 0);
      const avgLatency =
        samples.reduce((sum, s) => sum + s.inferenceLatencyMs, 0) / samples.length;

      metricsPerRobot[robotId] = {
        robotId,
        totalRequests,
        errorCount,
        avgLatencyMs: avgLatency,
        lastSampleTime: latestSample.timestamp,
      };

      // Accumulate totals
      totalSuccesses += samples.reduce((sum, s) => sum + s.successCount, 0);
      totalErrors += errorCount;
      totalTaskSuccesses += samples.reduce((sum, s) => sum + s.taskSuccesses, 0);
      totalTaskFailures += samples.reduce((sum, s) => sum + s.taskFailures, 0);

      // Collect latencies for percentile calculation
      for (const s of samples) {
        if (s.inferenceLatencyMs > 0) {
          allLatencies.push(s.inferenceLatencyMs);
        }
      }
    }

    // Calculate latency percentiles
    allLatencies.sort((a, b) => a - b);
    const latencyP50 = this.percentile(allLatencies, 50);
    const latencyP95 = this.percentile(allLatencies, 95);
    const latencyP99 = this.percentile(allLatencies, 99);

    // Calculate rates
    const totalInferences = totalSuccesses + totalErrors;
    const errorRate = totalInferences > 0 ? totalErrors / totalInferences : 0;
    const totalTasks = totalTaskSuccesses + totalTaskFailures;
    const taskSuccessRate = totalTasks > 0 ? totalTaskSuccesses / totalTasks : 1;

    return {
      deploymentId,
      windowStartTime: cutoffTime,
      windowEndTime: now,
      totalInferences,
      successfulInferences: totalSuccesses,
      errorRate,
      latencyP50,
      latencyP95,
      latencyP99,
      taskSuccessRate,
      robotCount: robotSamples.size,
      metricsPerRobot,
    };
  }

  /**
   * Calculate percentile from sorted array
   */
  private percentile(sortedValues: number[], p: number): number {
    if (sortedValues.length === 0) return 0;
    const index = Math.ceil((p / 100) * sortedValues.length) - 1;
    return sortedValues[Math.max(0, index)];
  }

  // ============================================================================
  // THRESHOLD CHECKING
  // ============================================================================

  /**
   * Check thresholds for a deployment
   */
  private async checkDeploymentThresholds(deploymentId: string): Promise<void> {
    const deployment = await deploymentRepository.findById(deploymentId);
    if (!deployment) {
      return;
    }

    // Only check active deployments
    if (!['deploying', 'canary'].includes(deployment.status)) {
      return;
    }

    const metrics = this.getAggregatedMetrics(deploymentId);
    if (!metrics) {
      return;
    }

    const result = this.checkThresholds(metrics, deployment.rollbackThresholds);

    if (!result.passed) {
      console.warn(
        `[DeploymentMetricsService] Threshold violations for ${deploymentId}:`,
        result.violations
      );

      // Emit event
      this.emit('threshold_violation', {
        deploymentId,
        metrics,
        violations: result.violations,
      });

      // Call callback if set
      if (this.thresholdViolationCallback) {
        try {
          await this.thresholdViolationCallback(deploymentId, metrics, result);
        } catch (error) {
          console.error(
            `[DeploymentMetricsService] Threshold callback error:`,
            error
          );
        }
      }
    }
  }

  /**
   * Check if metrics violate rollback thresholds
   */
  checkThresholds(
    metrics: AggregatedDeploymentMetrics,
    thresholds: RollbackThresholds
  ): ThresholdCheckResult {
    const violations: ThresholdViolation[] = [];

    // Check error rate
    if (metrics.errorRate > thresholds.errorRate) {
      violations.push({
        metric: 'errorRate',
        currentValue: metrics.errorRate,
        threshold: thresholds.errorRate,
        severity: metrics.errorRate > thresholds.errorRate * 2 ? 'critical' : 'warning',
      });
    }

    // Check latency P99
    if (metrics.latencyP99 > thresholds.latencyP99) {
      violations.push({
        metric: 'latencyP99',
        currentValue: metrics.latencyP99,
        threshold: thresholds.latencyP99,
        severity: metrics.latencyP99 > thresholds.latencyP99 * 2 ? 'critical' : 'warning',
      });
    }

    // Check task failure rate
    const failureRate = 1 - metrics.taskSuccessRate;
    if (failureRate > thresholds.failureRate) {
      violations.push({
        metric: 'failureRate',
        currentValue: failureRate,
        threshold: thresholds.failureRate,
        severity: failureRate > thresholds.failureRate * 2 ? 'critical' : 'warning',
      });
    }

    return {
      passed: violations.length === 0,
      violations,
    };
  }

  // ============================================================================
  // QUERIES
  // ============================================================================

  /**
   * Check if monitoring is active for a deployment
   */
  isMonitoring(deploymentId: string): boolean {
    return this.pollIntervals.has(deploymentId);
  }

  /**
   * Get metric window for a deployment
   */
  getMetricWindow(deploymentId: string): MetricWindow | undefined {
    return this.metricWindows.get(deploymentId);
  }

  // ============================================================================
  // CLEANUP
  // ============================================================================

  /**
   * Cleanup all monitoring
   */
  cleanup(): void {
    for (const [deploymentId] of this.pollIntervals) {
      this.stopMonitoring(deploymentId);
    }
    this.metricWindows.clear();
    console.log('[DeploymentMetricsService] Cleaned up');
  }

  /**
   * Cleanup old metric windows (for deployments that completed)
   */
  cleanupOldWindows(maxAgeMs: number = 24 * 60 * 60 * 1000): void {
    const cutoff = Date.now() - maxAgeMs;
    for (const [deploymentId, window] of this.metricWindows) {
      // Only clean up if not actively monitoring
      if (!this.pollIntervals.has(deploymentId)) {
        const latestSample = window.samples[window.samples.length - 1];
        if (!latestSample || latestSample.timestamp < cutoff) {
          this.metricWindows.delete(deploymentId);
          console.log(`[DeploymentMetricsService] Cleaned up old window: ${deploymentId}`);
        }
      }
    }
  }
}

// Export singleton instance
export const deploymentMetricsService = DeploymentMetricsService.getInstance();
