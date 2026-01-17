/**
 * @file metrics.ts
 * @description Latency and inference metrics tracking for VLA client
 * @feature vla
 */

import type { LatencyMetrics, InferenceMetrics } from './types.js';

/**
 * Rolling window for tracking latency samples.
 */
class LatencyWindow {
  private samples: number[] = [];
  private readonly maxSamples: number;

  constructor(maxSamples: number = 1000) {
    this.maxSamples = maxSamples;
  }

  /**
   * Add a latency sample to the window.
   */
  add(latencyMs: number): void {
    this.samples.push(latencyMs);
    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }
  }

  /**
   * Get percentile value from samples.
   */
  percentile(p: number): number {
    if (this.samples.length === 0) return 0;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  /**
   * Get average latency.
   */
  average(): number {
    if (this.samples.length === 0) return 0;
    return this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
  }

  /**
   * Get sample count.
   */
  count(): number {
    return this.samples.length;
  }

  /**
   * Clear all samples.
   */
  clear(): void {
    this.samples = [];
  }
}

/**
 * VLAMetrics tracks inference latency and success/failure rates.
 */
export class VLAMetrics {
  private latencyWindow: LatencyWindow;
  private _successCount = 0;
  private _failureCount = 0;
  private _fallbackCount = 0;
  private readonly startTime: number;

  constructor(windowSize: number = 1000) {
    this.latencyWindow = new LatencyWindow(windowSize);
    this.startTime = Date.now();
  }

  /**
   * Record a successful inference with latency.
   */
  recordSuccess(latencyMs: number): void {
    this.latencyWindow.add(latencyMs);
    this._successCount++;
  }

  /**
   * Record a failed inference.
   */
  recordFailure(): void {
    this._failureCount++;
  }

  /**
   * Record a fallback request (REST instead of gRPC).
   */
  recordFallback(latencyMs: number): void {
    this.latencyWindow.add(latencyMs);
    this._fallbackCount++;
    this._successCount++;
  }

  /**
   * Get current latency metrics.
   */
  getLatencyMetrics(): LatencyMetrics {
    return {
      p50: this.latencyWindow.percentile(50),
      p95: this.latencyWindow.percentile(95),
      p99: this.latencyWindow.percentile(99),
      avg: this.latencyWindow.average(),
      count: this.latencyWindow.count(),
    };
  }

  /**
   * Get all inference metrics.
   */
  getMetrics(): InferenceMetrics {
    const total = this._successCount + this._failureCount;
    return {
      latency: this.getLatencyMetrics(),
      successCount: this._successCount,
      failureCount: this._failureCount,
      fallbackCount: this._fallbackCount,
      successRate: total > 0 ? this._successCount / total : 1,
    };
  }

  /**
   * Get metrics in Prometheus format.
   */
  toPrometheusFormat(): string {
    const metrics = this.getMetrics();
    const uptimeSeconds = (Date.now() - this.startTime) / 1000;

    return [
      '# HELP vla_inference_latency_ms VLA inference latency in milliseconds',
      '# TYPE vla_inference_latency_ms summary',
      `vla_inference_latency_ms{quantile="0.5"} ${metrics.latency.p50.toFixed(2)}`,
      `vla_inference_latency_ms{quantile="0.95"} ${metrics.latency.p95.toFixed(2)}`,
      `vla_inference_latency_ms{quantile="0.99"} ${metrics.latency.p99.toFixed(2)}`,
      `vla_inference_latency_ms_sum ${(metrics.latency.avg * metrics.latency.count).toFixed(2)}`,
      `vla_inference_latency_ms_count ${metrics.latency.count}`,
      '',
      '# HELP vla_inference_requests_total Total number of VLA inference requests',
      '# TYPE vla_inference_requests_total counter',
      `vla_inference_requests_total{status="success"} ${metrics.successCount}`,
      `vla_inference_requests_total{status="failure"} ${metrics.failureCount}`,
      `vla_inference_requests_total{status="fallback"} ${metrics.fallbackCount}`,
      '',
      '# HELP vla_inference_success_rate VLA inference success rate',
      '# TYPE vla_inference_success_rate gauge',
      `vla_inference_success_rate ${metrics.successRate.toFixed(4)}`,
      '',
      '# HELP vla_client_uptime_seconds VLA client uptime in seconds',
      '# TYPE vla_client_uptime_seconds counter',
      `vla_client_uptime_seconds ${uptimeSeconds.toFixed(2)}`,
      '',
    ].join('\n');
  }

  /**
   * Reset all metrics.
   */
  reset(): void {
    this.latencyWindow.clear();
    this._successCount = 0;
    this._failureCount = 0;
    this._fallbackCount = 0;
  }
}
