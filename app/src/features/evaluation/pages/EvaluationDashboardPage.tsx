/**
 * @file EvaluationDashboardPage.tsx
 * @description Evaluation dashboard — the missing link between Train → Deploy → Evaluate → Collect
 * @feature evaluation
 */

import { useState, useEffect, useCallback } from 'react';
import type { EvaluationPeriod, EvaluationEpisode, SuccessRateResult, ErrorBreakdownItem, ModelComparisonResult } from '../types';
import { evaluationApi } from '../api';
import { PeriodSelector } from '../components/PeriodSelector';
import { SuccessRateChart } from '../components/SuccessRateChart';
import { ErrorAnalysisPanel } from '../components/ErrorAnalysisPanel';
import { ModelComparisonTable } from '../components/ModelComparisonTable';
import { RolloutTimeline } from '../components/RolloutTimeline';

// ============================================================================
// STAT CARD
// ============================================================================

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-theme section-primary p-5">
      <p className="text-sm text-theme-secondary">{label}</p>
      <p className="text-2xl font-bold text-theme-primary mt-1">{value}</p>
      {sub && <p className="text-xs text-theme-tertiary mt-1">{sub}</p>}
    </div>
  );
}

// ============================================================================
// PAGE
// ============================================================================

export function EvaluationDashboardPage() {
  const [period, setPeriod] = useState<EvaluationPeriod>('7d');
  const [loading, setLoading] = useState(true);

  // Data states
  const [episodes, setEpisodes] = useState<EvaluationEpisode[]>([]);
  const [successRate, setSuccessRate] = useState<SuccessRateResult | null>(null);
  const [errors, setErrors] = useState<ErrorBreakdownItem[]>([]);
  const [comparison, setComparison] = useState<ModelComparisonResult | null>(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);

  const fetchData = useCallback(async (p: EvaluationPeriod) => {
    setLoading(true);
    try {
      const [episodesRes, successRateRes, errorsRes] = await Promise.all([
        evaluationApi.listEpisodes({ period: p, limit: 50 }),
        evaluationApi.getSuccessRate({ period: p }),
        evaluationApi.getErrorBreakdown({ period: p }),
      ]);
      setEpisodes(episodesRes.episodes);
      setSuccessRate(successRateRes);
      setErrors(errorsRes.errors);

      // Auto-compare the two most common model versions
      const modelCounts = new Map<string, number>();
      for (const ep of episodesRes.episodes) {
        modelCounts.set(ep.modelVersion, (modelCounts.get(ep.modelVersion) ?? 0) + 1);
      }
      const topModels = [...modelCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([mv]) => mv);

      if (topModels.length >= 2) {
        setComparisonLoading(true);
        try {
          const cmp = await evaluationApi.compareModels(topModels[0], topModels[1], p);
          setComparison(cmp);
        } catch {
          setComparison(null);
        }
        setComparisonLoading(false);
      } else {
        setComparison(null);
      }
    } catch (err) {
      console.error('[EvaluationDashboard] Failed to fetch data:', err);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData(period);
  }, [period, fetchData]);

  const handlePeriodChange = (p: EvaluationPeriod) => {
    setPeriod(p);
  };

  // Computed stats
  const avgDurationMs = episodes.length > 0
    ? Math.round(episodes.reduce((sum, e) => sum + e.durationMs, 0) / episodes.length)
    : 0;

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-theme-primary">Evaluation Dashboard</h1>
          <p className="text-sm text-theme-secondary mt-1">
            Track VLA model performance across evaluation rollouts
          </p>
        </div>
        <PeriodSelector value={period} onChange={handlePeriodChange} />
      </div>

      {/* Loading state */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cobalt" />
        </div>
      ) : (
        <>
          {/* Row 1: Stats Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard
              label="Success Rate"
              value={`${successRate?.successRate.toFixed(1) ?? '0'}%`}
              sub={`${successRate?.successfulEpisodes ?? 0} of ${successRate?.totalEpisodes ?? 0} episodes`}
            />
            <StatCard
              label="Total Episodes"
              value={String(successRate?.totalEpisodes ?? 0)}
              sub={`Last ${period}`}
            />
            <StatCard
              label="Avg Duration"
              value={formatDuration(avgDurationMs)}
              sub={episodes.length > 0 ? `Across ${episodes.length} episodes` : 'No data'}
            />
          </div>

          {/* Row 2: Success Rate Chart */}
          <div className="rounded-lg border border-theme section-primary p-5">
            <h2 className="text-lg font-semibold text-theme-primary mb-4">Success Rate Over Time</h2>
            <SuccessRateChart episodes={episodes} height={300} />
          </div>

          {/* Row 3: Error Analysis + Model Comparison */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="rounded-lg border border-theme section-primary p-5">
              <h2 className="text-lg font-semibold text-theme-primary mb-4">Error Analysis</h2>
              <ErrorAnalysisPanel errors={errors} height={300} />
            </div>
            <div className="rounded-lg border border-theme section-primary p-5">
              <h2 className="text-lg font-semibold text-theme-primary mb-4">Model Comparison</h2>
              <ModelComparisonTable comparison={comparison} loading={comparisonLoading} />
            </div>
          </div>

          {/* Row 4: Rollout Timeline */}
          <div className="rounded-lg border border-theme section-primary p-5">
            <h2 className="text-lg font-semibold text-theme-primary mb-4">Recent Rollouts</h2>
            <RolloutTimeline episodes={episodes} maxItems={10} />
          </div>
        </>
      )}
    </div>
  );
}
