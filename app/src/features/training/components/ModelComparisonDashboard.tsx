/**
 * @file ModelComparisonDashboard.tsx
 * @description Side-by-side comparison of model versions and their metrics
 * @feature training
 */

import { useState, useMemo } from 'react';
import { Card, Badge, Tabs, Button } from '@/shared/components/ui';
import { MetricsComparisonChart, MultiMetricComparisonChart } from './MetricsComparisonChart';
import type { ModelVersion, RunComparison } from '../types';

export interface ModelComparisonDashboardProps {
  versions: ModelVersion[];
  comparison?: RunComparison;
  onClose?: () => void;
  onDeploy?: (version: ModelVersion) => void;
}

/**
 * Side-by-side model version comparison dashboard
 */
export function ModelComparisonDashboard({
  versions,
  comparison,
  onClose,
  onDeploy,
}: ModelComparisonDashboardProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'metrics' | 'params'>('overview');
  const [selectedForDeploy, setSelectedForDeploy] = useState<string | null>(null);

  // Get all unique metric keys across versions
  const allMetricKeys = useMemo(() => {
    const keys = new Set<string>();
    versions.forEach((v) => {
      if (v.metrics) {
        Object.keys(v.metrics).forEach((k) => keys.add(k));
      }
    });
    // Also add from comparison if available
    if (comparison?.metrics) {
      comparison.metrics.forEach((m) => {
        Object.keys(m.metrics).forEach((k) => keys.add(k));
      });
    }
    return Array.from(keys).sort();
  }, [versions, comparison]);

  // Prepare chart data
  const chartData = useMemo(() => {
    if (comparison?.metrics) {
      return comparison.metrics.map((m) => ({
        name: m.run_name || m.run_id.slice(0, 8),
        runId: m.run_id,
        metrics: m.metrics,
      }));
    }
    return versions.map((v) => ({
      name: `v${v.version}`,
      runId: v.run_id || v.version,
      metrics: v.metrics || {},
    }));
  }, [versions, comparison]);

  // Key metrics to highlight
  const keyMetrics = ['final_loss', 'best_val_loss', 'accuracy', 'training_time'];
  const displayMetrics = allMetricKeys.filter((k) => keyMetrics.includes(k));

  return (
    <Card>
      <Card.Header>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-theme-primary">
            Comparing {versions.length} Model{versions.length !== 1 ? 's' : ''}
          </h3>
          <div className="flex items-center gap-3">
            {onDeploy && versions.length > 0 && (
              <div className="flex items-center gap-2">
                <select
                  value={selectedForDeploy || ''}
                  onChange={(e) => setSelectedForDeploy(e.target.value || null)}
                  className="px-2 py-1.5 text-sm rounded-lg border border-theme-secondary/30 bg-theme-primary text-theme-primary focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="">Select version...</option>
                  {versions.map((v) => (
                    <option key={v.version} value={v.version}>
                      v{v.version} {v.current_stage === 'Production' ? '(Production)' : ''}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  onClick={() => {
                    const version = versions.find((v) => v.version === selectedForDeploy);
                    if (version) onDeploy(version);
                  }}
                  disabled={!selectedForDeploy}
                >
                  <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                    />
                  </svg>
                  Deploy
                </Button>
              </div>
            )}
            {onClose && (
              <button
                onClick={onClose}
                className="text-theme-tertiary hover:text-theme-primary"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            )}
          </div>
        </div>
      </Card.Header>

      <Card.Body className="space-y-6">
        <Tabs
          activeTab={activeTab}
          onTabChange={(id) => setActiveTab(id as typeof activeTab)}
          tabs={[
            { id: 'overview', label: 'Overview', content: null },
            { id: 'metrics', label: 'Metrics', content: null },
            { id: 'params', label: 'Parameters', content: null },
          ]}
        />

        {/* Overview tab */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Version cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {versions.map((version) => (
                <VersionComparisonCard key={version.version} version={version} />
              ))}
            </div>

            {/* Key metrics chart */}
            {displayMetrics.length > 0 && chartData.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-theme-primary mb-3">
                  Key Metrics Comparison
                </h4>
                <MultiMetricComparisonChart
                  data={chartData}
                  metricKeys={displayMetrics.slice(0, 4)}
                  height={300}
                />
              </div>
            )}
          </div>
        )}

        {/* Metrics tab */}
        {activeTab === 'metrics' && (
          <div className="space-y-6">
            {/* Metric comparison table */}
            <MetricsComparisonTable
              versions={versions}
              metricKeys={allMetricKeys}
            />

            {/* Individual metric charts */}
            {allMetricKeys.slice(0, 4).map((metricKey) => (
              <div key={metricKey}>
                <h4 className="text-sm font-medium text-theme-primary mb-3">
                  {formatMetricName(metricKey)}
                </h4>
                <MetricsComparisonChart
                  data={chartData}
                  metricKey={metricKey}
                  height={200}
                  lowerIsBetter={metricKey.includes('loss')}
                />
              </div>
            ))}
          </div>
        )}

        {/* Parameters tab */}
        {activeTab === 'params' && (
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-theme-primary">
              Hyperparameter Comparison
            </h4>
            <ParametersComparisonTable
              versions={versions}
              comparison={comparison}
            />
          </div>
        )}
      </Card.Body>
    </Card>
  );
}

interface VersionComparisonCardProps {
  version: ModelVersion;
}

function VersionComparisonCard({ version }: VersionComparisonCardProps) {
  const stageColors: Record<string, string> = {
    Production: 'bg-green-100 text-green-800',
    Staging: 'bg-yellow-100 text-yellow-800',
    Archived: 'bg-gray-100 text-gray-800',
    None: 'bg-blue-100 text-blue-800',
  };

  return (
    <div className="p-4 bg-theme-secondary/10 rounded-lg">
      <div className="flex items-center justify-between mb-3">
        <span className="text-lg font-semibold text-theme-primary">v{version.version}</span>
        <Badge className={stageColors[version.current_stage] || stageColors.None}>
          {version.current_stage}
        </Badge>
      </div>

      {version.description && (
        <p className="text-sm text-theme-secondary mb-3">{version.description}</p>
      )}

      {/* Key metrics */}
      {version.metrics && (
        <div className="space-y-1">
          {Object.entries(version.metrics)
            .slice(0, 4)
            .map(([key, value]) => (
              <div key={key} className="flex justify-between text-sm">
                <span className="text-theme-tertiary">{formatMetricName(key)}</span>
                <span className="font-medium text-theme-primary">
                  {formatMetricValue(value)}
                </span>
              </div>
            ))}
        </div>
      )}

      <div className="mt-3 pt-3 border-t border-theme-secondary/20 text-xs text-theme-tertiary">
        Created {new Date(version.creation_timestamp).toLocaleDateString()}
      </div>
    </div>
  );
}

interface MetricsComparisonTableProps {
  versions: ModelVersion[];
  metricKeys: string[];
}

function MetricsComparisonTable({ versions, metricKeys }: MetricsComparisonTableProps) {
  if (metricKeys.length === 0) {
    return <p className="text-theme-secondary text-sm">No metrics available for comparison.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-theme-secondary/20">
            <th className="py-2 px-3 text-left text-theme-tertiary font-medium">Metric</th>
            {versions.map((v) => (
              <th key={v.version} className="py-2 px-3 text-right text-theme-tertiary font-medium">
                v{v.version}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {metricKeys.map((key) => {
            const values = versions.map((v) => v.metrics?.[key]);
            const numericValues = values.filter((v): v is number => typeof v === 'number');
            const isLoss = key.includes('loss');
            const best = isLoss ? Math.min(...numericValues) : Math.max(...numericValues);

            return (
              <tr key={key} className="border-b border-theme-secondary/10">
                <td className="py-2 px-3 text-theme-secondary">{formatMetricName(key)}</td>
                {values.map((value, i) => {
                  const isBest = value === best && numericValues.length > 1;
                  return (
                    <td
                      key={i}
                      className={`py-2 px-3 text-right font-mono ${
                        isBest ? 'text-green-600 font-semibold' : 'text-theme-primary'
                      }`}
                    >
                      {value !== undefined ? formatMetricValue(value) : '—'}
                      {isBest && <span className="ml-1 text-green-500">★</span>}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface ParametersComparisonTableProps {
  versions: ModelVersion[];
  comparison?: RunComparison;
}

function ParametersComparisonTable({ versions, comparison }: ParametersComparisonTableProps) {
  // Collect all parameter keys
  const allParams = new Set<string>();

  if (comparison?.params) {
    comparison.params.forEach((p) => {
      Object.keys(p.params).forEach((k) => allParams.add(k));
    });
  }

  // Also check version tags for params
  versions.forEach((v) => {
    if (v.tags) {
      Object.keys(v.tags)
        .filter((k) => k.startsWith('param_') || ['learning_rate', 'batch_size', 'epochs'].includes(k))
        .forEach((k) => allParams.add(k));
    }
  });

  const paramKeys = Array.from(allParams).sort();

  if (paramKeys.length === 0) {
    return <p className="text-theme-secondary text-sm">No parameters available for comparison.</p>;
  }

  // Get params for each version
  const versionParams = versions.map((v) => {
    if (comparison?.params) {
      const runParams = comparison.params.find((p) => p.run_id === v.run_id);
      if (runParams) return runParams.params;
    }
    return v.tags || {};
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-theme-secondary/20">
            <th className="py-2 px-3 text-left text-theme-tertiary font-medium">Parameter</th>
            {versions.map((v) => (
              <th key={v.version} className="py-2 px-3 text-right text-theme-tertiary font-medium">
                v{v.version}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {paramKeys.map((key) => (
            <tr key={key} className="border-b border-theme-secondary/10">
              <td className="py-2 px-3 text-theme-secondary">
                {formatMetricName(key.replace('param_', ''))}
              </td>
              {versionParams.map((params, i) => (
                <td key={i} className="py-2 px-3 text-right font-mono text-theme-primary">
                  {params[key] !== undefined ? String(params[key]) : '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatMetricName(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace('Loss', 'Loss')
    .replace('Lr', 'LR');
}

function formatMetricValue(value: number | string): string {
  if (typeof value === 'string') return value;
  if (Math.abs(value) < 0.001) return value.toExponential(2);
  if (Math.abs(value) < 1) return value.toFixed(4);
  if (Math.abs(value) < 100) return value.toFixed(2);
  return value.toLocaleString();
}
