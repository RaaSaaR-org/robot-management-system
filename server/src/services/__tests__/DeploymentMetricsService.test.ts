/**
 * @file DeploymentMetricsService.test.ts
 * @description Unit tests for DeploymentMetricsService — metric recording, aggregation, threshold checks
 * @feature vla
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  DeploymentMetricSample,
  AggregatedDeploymentMetrics,
} from '../../types/deployment.types.js';
import type { RollbackThresholds } from '../../types/vla.types.js';

// Mock external boundaries pulled in transitively by the service import.
vi.mock('./RobotManager.js', () => ({
  robotManager: { getRegisteredRobot: vi.fn() },
}));
vi.mock('../../repositories/index.js', () => ({
  deploymentRepository: { findById: vi.fn() },
}));
vi.mock('../HttpClient.js', () => ({
  HttpClient: vi.fn(),
  HTTP_TIMEOUTS: { SHORT: 1000, MEDIUM: 5000, LONG: 30000 },
}));

import { DeploymentMetricsService } from '../DeploymentMetricsService.js';

const makeSample = (overrides: Partial<DeploymentMetricSample> = {}): DeploymentMetricSample => ({
  robotId: 'robot-1',
  timestamp: Date.now(),
  inferenceLatencyMs: 100,
  errorCount: 0,
  successCount: 10,
  taskFailures: 0,
  taskSuccesses: 5,
  ...overrides,
});

describe('DeploymentMetricsService', () => {
  let service: DeploymentMetricsService;

  beforeEach(() => {
    vi.clearAllMocks();
    // Singleton — fully reset its in-memory state between tests
    service = DeploymentMetricsService.getInstance();
    service.cleanup();
  });

  afterEach(() => {
    service.cleanup();
  });

  describe('getInstance', () => {
    it('returns the same singleton instance', () => {
      expect(DeploymentMetricsService.getInstance()).toBe(service);
    });
  });

  // --------------------------------------------------------------------------
  // recordMetric
  // --------------------------------------------------------------------------

  describe('recordMetric', () => {
    it('ignores samples when no monitoring window exists', () => {
      service.recordMetric('unknown-dep', makeSample());
      expect(service.getMetricWindow('unknown-dep')).toBeUndefined();
    });

    it('stores samples once a window is active', () => {
      service.startMonitoring('dep-1');
      service.recordMetric('dep-1', makeSample());
      const window = service.getMetricWindow('dep-1');
      expect(window?.samples).toHaveLength(1);
    });

    it('prunes samples older than the rolling window', () => {
      service.startMonitoring('dep-1');
      const old = makeSample({ timestamp: Date.now() - 2 * 60 * 60 * 1000 }); // 2h ago
      const fresh = makeSample({ timestamp: Date.now() });
      service.recordMetric('dep-1', old);
      service.recordMetric('dep-1', fresh);
      const window = service.getMetricWindow('dep-1');
      expect(window?.samples).toHaveLength(1);
      expect(window?.samples[0].timestamp).toBe(fresh.timestamp);
    });
  });

  // --------------------------------------------------------------------------
  // getAggregatedMetrics
  // --------------------------------------------------------------------------

  describe('getAggregatedMetrics', () => {
    it('returns null when there is no window', () => {
      expect(service.getAggregatedMetrics('none')).toBeNull();
    });

    it('returns null when the window has no samples', () => {
      service.startMonitoring('dep-1');
      expect(service.getAggregatedMetrics('dep-1')).toBeNull();
    });

    it('aggregates totals, error rate, and task success rate', () => {
      service.startMonitoring('dep-1');
      service.recordMetric(
        'dep-1',
        makeSample({ robotId: 'r1', successCount: 8, errorCount: 2, taskSuccesses: 3, taskFailures: 1 })
      );
      service.recordMetric(
        'dep-1',
        makeSample({ robotId: 'r2', successCount: 10, errorCount: 0, taskSuccesses: 4, taskFailures: 0 })
      );

      const agg = service.getAggregatedMetrics('dep-1') as AggregatedDeploymentMetrics;
      expect(agg.totalInferences).toBe(20); // 8+2+10+0
      expect(agg.successfulInferences).toBe(18);
      expect(agg.errorRate).toBeCloseTo(2 / 20);
      // tasks: successes 7, failures 1 => 7/8
      expect(agg.taskSuccessRate).toBeCloseTo(7 / 8);
      expect(agg.robotCount).toBe(2);
      expect(agg.metricsPerRobot['r1'].errorCount).toBe(2);
      expect(agg.metricsPerRobot['r1'].totalRequests).toBe(10);
    });

    it('computes latency percentiles from recorded samples', () => {
      service.startMonitoring('dep-1');
      // distinct latencies so percentile picks are observable
      for (const lat of [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]) {
        service.recordMetric('dep-1', makeSample({ robotId: 'r1', inferenceLatencyMs: lat }));
      }
      const agg = service.getAggregatedMetrics('dep-1') as AggregatedDeploymentMetrics;
      // p50 of 10 sorted values => index ceil(0.5*10)-1 = 4 => value 50
      expect(agg.latencyP50).toBe(50);
      // p95 => index ceil(0.95*10)-1 = 9 => value 100
      expect(agg.latencyP95).toBe(100);
      expect(agg.latencyP99).toBe(100);
    });

    it('defaults task success rate to 1 when there are no tasks', () => {
      service.startMonitoring('dep-1');
      service.recordMetric(
        'dep-1',
        makeSample({ taskSuccesses: 0, taskFailures: 0, successCount: 5, errorCount: 0 })
      );
      const agg = service.getAggregatedMetrics('dep-1') as AggregatedDeploymentMetrics;
      expect(agg.taskSuccessRate).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // checkThresholds
  // --------------------------------------------------------------------------

  describe('checkThresholds', () => {
    const thresholds: RollbackThresholds = {
      errorRate: 0.05,
      latencyP99: 500,
      failureRate: 0.1,
    };

    const baseMetrics = (overrides: Partial<AggregatedDeploymentMetrics>): AggregatedDeploymentMetrics => ({
      deploymentId: 'dep-1',
      windowStartTime: 0,
      windowEndTime: 0,
      totalInferences: 100,
      successfulInferences: 100,
      errorRate: 0,
      latencyP50: 10,
      latencyP95: 20,
      latencyP99: 30,
      taskSuccessRate: 1,
      robotCount: 1,
      metricsPerRobot: {},
      ...overrides,
    });

    it('passes when all metrics are within thresholds', () => {
      const result = service.checkThresholds(baseMetrics({}), thresholds);
      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it('flags an error-rate violation as warning when under 2x threshold', () => {
      const result = service.checkThresholds(baseMetrics({ errorRate: 0.08 }), thresholds);
      const v = result.violations.find((x) => x.metric === 'errorRate');
      expect(v?.severity).toBe('warning');
      expect(result.passed).toBe(false);
    });

    it('flags an error-rate violation as critical when over 2x threshold', () => {
      const result = service.checkThresholds(baseMetrics({ errorRate: 0.2 }), thresholds);
      const v = result.violations.find((x) => x.metric === 'errorRate');
      expect(v?.severity).toBe('critical');
    });

    it('flags a latency P99 violation', () => {
      const result = service.checkThresholds(baseMetrics({ latencyP99: 600 }), thresholds);
      expect(result.violations.some((x) => x.metric === 'latencyP99')).toBe(true);
    });

    it('derives failure rate from task success rate', () => {
      // taskSuccessRate 0.8 => failureRate 0.2 > 0.1 threshold
      const result = service.checkThresholds(baseMetrics({ taskSuccessRate: 0.8 }), thresholds);
      const v = result.violations.find((x) => x.metric === 'failureRate');
      expect(v).toBeDefined();
      expect(v?.currentValue).toBeCloseTo(0.2);
    });
  });

  // --------------------------------------------------------------------------
  // monitoring lifecycle
  // --------------------------------------------------------------------------

  describe('monitoring lifecycle', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('tracks active monitoring state', () => {
      expect(service.isMonitoring('dep-1')).toBe(false);
      service.startMonitoring('dep-1');
      expect(service.isMonitoring('dep-1')).toBe(true);
      service.stopMonitoring('dep-1');
      expect(service.isMonitoring('dep-1')).toBe(false);
    });

    it('is idempotent — starting twice keeps a single window', () => {
      service.startMonitoring('dep-1');
      const first = service.getMetricWindow('dep-1');
      service.recordMetric('dep-1', makeSample());
      service.startMonitoring('dep-1'); // should be a no-op
      expect(service.getMetricWindow('dep-1')).toBe(first);
      expect(service.getMetricWindow('dep-1')?.samples).toHaveLength(1);
    });

    it('keeps the window after stopMonitoring for final reporting', () => {
      service.startMonitoring('dep-1');
      service.stopMonitoring('dep-1');
      expect(service.getMetricWindow('dep-1')).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // cleanupOldWindows
  // --------------------------------------------------------------------------

  describe('cleanupOldWindows', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('removes stale windows that are no longer monitored', () => {
      service.startMonitoring('dep-1');
      service.recordMetric('dep-1', makeSample({ timestamp: Date.now() }));
      service.stopMonitoring('dep-1');

      // Window's last sample is "now"; advancing past maxAge makes it stale
      service.cleanupOldWindows(1000);
      expect(service.getMetricWindow('dep-1')).toBeDefined(); // still fresh

      vi.advanceTimersByTime(2000);
      service.cleanupOldWindows(1000);
      expect(service.getMetricWindow('dep-1')).toBeUndefined();
    });

    it('does not remove windows that are actively monitored', () => {
      service.startMonitoring('dep-1');
      vi.advanceTimersByTime(10 * 60 * 60 * 1000);
      service.cleanupOldWindows(1000);
      expect(service.getMetricWindow('dep-1')).toBeDefined();
    });
  });
});
