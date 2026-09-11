/**
 * @file DeploymentMetricsPanel.tsx
 * @description Metrics tab of a deployment: error rate, task success and latency of the new model
 * @feature deployment
 */

import { Activity } from 'lucide-react';
import { EmptyState, KeyValueList, Panel, SkeletonText } from '@/shared/components/ui';
import type { AggregatedDeploymentMetrics, RollbackThresholds } from '../types';

export interface DeploymentMetricsPanelProps {
  metrics?: AggregatedDeploymentMetrics;
  thresholds?: RollbackThresholds;
  isLoading: boolean;
}

export function DeploymentMetricsPanel({ metrics, thresholds, isLoading }: DeploymentMetricsPanelProps) {
  if (isLoading && !metrics) {
    return (
      <Panel>
        <SkeletonText lines={4} />
      </Panel>
    );
  }
  if (!metrics) {
    return (
      <Panel>
        <EmptyState icon={<Activity />} title="No metrics yet" description="Metrics appear once robots run the new model." />
      </Panel>
    );
  }
  const limit = (v?: number, unit = '%') => (v === undefined ? '' : ` · limit ${unit === '%' ? (v * 100).toFixed(1) : v} ${unit}`);
  return (
    <Panel>
      <Panel.Header title="Performance" description={`Last window · ${metrics.sampleSize} requests from ${metrics.robotCount} robots`} />
      <Panel.Body>
        <KeyValueList
          columns={2}
          items={[
            { label: 'Error rate', value: `${(metrics.errorRate * 100).toFixed(2)}%${limit(thresholds?.errorRate)}` },
            { label: 'Task success', value: `${(metrics.taskSuccessRate * 100).toFixed(1)}%` },
            { label: 'P50 latency', value: `${metrics.latencyP50.toFixed(0)} ms` },
            { label: 'P95 latency', value: `${metrics.latencyP95.toFixed(0)} ms` },
            { label: 'P99 latency', value: `${metrics.latencyP99.toFixed(0)} ms${limit(thresholds?.latencyP99, 'ms')}` },
            { label: 'Inferences', value: `${metrics.successfulInferences} of ${metrics.totalInferences} succeeded` },
          ]}
        />
      </Panel.Body>
    </Panel>
  );
}
