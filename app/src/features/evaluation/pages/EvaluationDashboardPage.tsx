/**
 * @file EvaluationDashboardPage.tsx
 * @description Evaluation section of /training: how models perform on hardware — success, errors, comparison, rollouts
 * @feature evaluation
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, Play, Rocket } from 'lucide-react';
import { DemoFeaturePlaceholder } from '@/components/demo/DemoFeaturePlaceholder';
import {
  Button,
  EmptyState,
  ErrorState,
  NextStepBanner,
  Panel,
  Select,
  SkeletonRows,
  StatRow,
  StatTile,
  Toolbar,
} from '@/shared/components/ui';
import { getErrorMessage } from '@/shared/utils';
import type { ErrorBreakdownItem, EvaluationEpisode, EvaluationPeriod, ModelComparisonResult, SuccessRateResult } from '../types';
import { evaluationApi } from '../api';
import { PeriodSelector } from '../components/PeriodSelector';
import { SuccessRateChart } from '../components/SuccessRateChart';
import { ERROR_LABELS, ErrorAnalysisPanel } from '../components/ErrorAnalysisPanel';
import { ModelComparisonTable } from '../components/ModelComparisonTable';
import { RolloutTimeline } from '../components/RolloutTimeline';
import { HardwareTestPanel } from '../components/HardwareTestPanel';
import { RewardModelPanel } from '../components/RewardModelPanel';

export interface EvaluationDashboardPageProps {
  /** Controlled "Run hardware test" modal (the /training header owns the button). */
  testOpen?: boolean;
  onTestOpenChange?: (open: boolean) => void;
}

const PERIOD_HINT: Record<EvaluationPeriod, string> = { '24h': 'Last 24 h', '7d': 'Last 7 days', '30d': 'Last 30 days' };

export function EvaluationDashboardPage(props: EvaluationDashboardPageProps) {
  if (import.meta.env.VITE_DEMO_MODE === 'true') {
    return (
      <DemoFeaturePlaceholder
        featureName="Model Evaluation"
        icon={<BarChart3 className="w-12 h-12" />}
        description="Evaluate robot model performance with standardized benchmarks. Compare models, track regressions, and generate compliance reports."
        capabilities={[
          'Run standardized evaluation suites on robot hardware',
          'Compare model versions with performance benchmarks',
          'Generate EU AI Act compliance reports',
          'Track performance regressions over time',
        ]}
        docsSlug="architecture"
      />
    );
  }
  return <EvaluationSection {...props} />;
}

function EvaluationSection({ testOpen, onTestOpenChange }: EvaluationDashboardPageProps) {
  const [period, setPeriod] = useState<EvaluationPeriod>('7d');
  const [model, setModel] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [episodes, setEpisodes] = useState<EvaluationEpisode[]>([]);
  const [successRate, setSuccessRate] = useState<SuccessRateResult | null>(null);
  const [errors, setErrors] = useState<ErrorBreakdownItem[]>([]);
  const [comparison, setComparison] = useState<ModelComparisonResult | null>(null);
  const [comparing, setComparing] = useState(false);
  const [localOpen, setLocalOpen] = useState(false);
  const open = testOpen ?? localOpen;
  const setOpen = onTestOpenChange ?? setLocalOpen;

  const fetchData = useCallback(async (p: EvaluationPeriod, silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [eps, rate, errs] = await Promise.all([
        evaluationApi.listEpisodes({ period: p, limit: 50 }),
        evaluationApi.getSuccessRate({ period: p }),
        evaluationApi.getErrorBreakdown({ period: p }),
      ]);
      setEpisodes(eps.episodes);
      setSuccessRate(rate);
      setErrors(errs.errors);
      setError(null);
      // Compare the two most common model versions.
      const counts = new Map<string, number>();
      for (const ep of eps.episodes) counts.set(ep.modelVersion, (counts.get(ep.modelVersion) ?? 0) + 1);
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([mv]) => mv);
      if (top.length >= 2) {
        setComparing(true);
        setComparison(await evaluationApi.compareModels(top[0], top[1], p).catch(() => null));
        setComparing(false);
      } else {
        setComparison(null);
      }
    } catch (err) {
      setError(getErrorMessage(err, 'The evaluation service did not answer'));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchData(period); }, [period, fetchData]);

  const models = useMemo(() => [...new Set(episodes.map((e) => e.modelVersion))].sort(), [episodes]);
  const shown = useMemo(() => (model ? episodes.filter((e) => e.modelVersion === model) : episodes), [episodes, model]);
  const shownRate = model && shown.length > 0 ? (shown.filter((e) => e.success).length / shown.length) * 100 : successRate?.successRate ?? 0;
  const avgMs = shown.length > 0 ? Math.round(shown.reduce((s, e) => s + e.durationMs, 0) / shown.length) : 0;
  const topError = errors[0];

  return (
    <div className="flex flex-col gap-6">
      <Toolbar
        filters={
          models.length > 1 ? (
            <Select aria-label="Model" fullWidth={false} className="w-52" placeholder="All models" options={models.map((m) => ({ value: m, label: m }))} value={model} onChange={(e) => setModel(e.target.value)} />
          ) : undefined
        }
        actions={<PeriodSelector value={period} onChange={setPeriod} />}
      />

      {loading ? (
        <Panel><SkeletonRows rows={4} columns={4} /></Panel>
      ) : error ? (
        <Panel><ErrorState title="Couldn't load evaluations" message={error} onRetry={() => void fetchData(period)} /></Panel>
      ) : episodes.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<BarChart3 />}
            title="No evaluations yet"
            description="This section fills up as you run hardware tests: each test runs closed-loop episodes on a robot and records every result."
            action={<Button leftIcon={<Play className="h-4 w-4" />} onClick={() => setOpen(true)}>Run hardware test</Button>}
          />
        </Panel>
      ) : (
        <>
          <StatRow columns={4}>
            <StatTile label="Success rate" value={shownRate.toFixed(1)} unit="%" tone={shownRate >= 80 ? 'success' : shownRate >= 50 ? 'warning' : 'danger'} hint={model ? `${shown.length} episodes of ${model}` : `${successRate?.successfulEpisodes ?? 0} of ${successRate?.totalEpisodes ?? 0} episodes`} />
            <StatTile label="Episodes" value={model ? shown.length : successRate?.totalEpisodes ?? 0} hint={PERIOD_HINT[period]} />
            <StatTile label="Mean duration" value={avgMs < 1000 ? avgMs : (avgMs / 1000).toFixed(1)} unit={avgMs < 1000 ? 'ms' : 's'} hint={`Across ${shown.length} episodes`} />
            <StatTile label="Top error" value={topError ? ERROR_LABELS[topError.errorType] ?? topError.errorType : 'None'} tone={topError ? 'warning' : 'success'} hint={topError ? `${topError.percentage.toFixed(0)}% of failures` : 'No failed episodes'} />
          </StatRow>

          <Panel>
            <Panel.Header title="Success rate over time" />
            <Panel.Body><SuccessRateChart episodes={shown} /></Panel.Body>
          </Panel>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Panel>
              <Panel.Header title="Error analysis" description="Why episodes failed." />
              <Panel.Body><ErrorAnalysisPanel errors={errors} /></Panel.Body>
            </Panel>
            <Panel>
              <Panel.Header title="Model comparison" description="The two most-tested versions in this period." />
              <Panel.Body><ModelComparisonTable comparison={comparison} loading={comparing} /></Panel.Body>
            </Panel>
          </div>

          <Panel>
            <Panel.Header title="Recent rollouts" />
            <Panel.Body><RolloutTimeline episodes={shown} maxItems={10} /></Panel.Body>
          </Panel>
        </>
      )}

      <HardwareTestPanel isOpen={open} onOpenChange={setOpen} onComplete={() => void fetchData(period, true)} />
      <RewardModelPanel />

      {!loading && episodes.length > 0 && (
        <NextStepBanner
          variant="subtle"
          title="Deploy the model"
          description="Roll a model that holds up on hardware out to the fleet as a canary."
          ctaLabel="Open deployments"
          ctaHref="/deployments"
          icon={<Rocket className="h-4 w-4" />}
        />
      )}
    </div>
  );
}
