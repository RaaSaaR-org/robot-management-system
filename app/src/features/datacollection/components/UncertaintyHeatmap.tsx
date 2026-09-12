/**
 * @file UncertaintyHeatmap.tsx
 * @description Uncertainty tab of /data-collection: a model's prediction
 *              uncertainty by task category and environment, on tokens.
 * @feature datacollection
 */

import { TrendingUp, TrendingDown, Minus, BarChart3 } from 'lucide-react';
import {
  EmptyState, Panel, ProgressBar, SkeletonRows, StatRow, StatTile, InfoIcon, type Tone,
} from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { ModelSelector } from './ModelSelector';
import { useUncertaintyAnalysis } from '../hooks/datacollection';
import type { CategoryUncertainty } from '../types/datacollection.types';
import { TREND_COLORS } from '../types/datacollection.types';
import type { RegisteredModel } from '@/features/training/types';
import { UI_DATE_LOCALE } from '@/shared/utils/format';

export interface UncertaintyHeatmapProps {
  models: RegisteredModel[];
  selectedModelId: string | null;
  onModelChange: (modelId: string | null) => void;
  modelsLoading?: boolean;
  className?: string;
}

function uncertaintyBar(u: number): 'success' | 'warning' | 'error' {
  if (u >= 0.7) return 'error';
  if (u >= 0.3) return 'warning';
  return 'success';
}

function uncertaintyTone(u: number): Tone {
  if (u >= 0.7) return 'stopped';
  if (u >= 0.3) return 'gated';
  return 'live';
}

const TREND_ICON = { improving: TrendingDown, stable: Minus, degrading: TrendingUp } as const;

function UncertaintyCell({ category, data }: { category: string; data: CategoryUncertainty }) {
  const Icon = TREND_ICON[data.recentTrend] ?? Minus;
  return (
    <Panel padding="sm" className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="truncate text-sm font-semibold text-ink-primary">{category}</div>
        <span className={cn('inline-flex shrink-0 items-center gap-1 text-xs capitalize', TREND_COLORS[data.recentTrend])}>
          <Icon className="h-4 w-4" strokeWidth={1.75} />
          {data.recentTrend}
        </span>
      </div>
      <ProgressBar value={data.meanUncertainty * 100} variant={uncertaintyBar(data.meanUncertainty)} size="sm" label="Uncertainty" />
      <dl className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <dt className="text-ink-tertiary">Samples</dt>
          <dd className="font-medium tabular-nums text-ink-primary">{data.sampleCount.toLocaleString(UI_DATE_LOCALE)}</dd>
        </div>
        <div>
          <dt className="text-ink-tertiary">Confidence range</dt>
          <dd className="font-medium tabular-nums text-ink-primary">
            {(data.minConfidence * 100).toFixed(0)}–{(data.maxConfidence * 100).toFixed(0)}%
          </dd>
        </div>
      </dl>
    </Panel>
  );
}

function CategoryGrid({ title, entries }: { title: string; entries: [string, CategoryUncertainty][] }) {
  if (entries.length === 0) return null;
  return (
    <Panel>
      <Panel.Header title={title} />
      <Panel.Body>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {entries.map(([category, data]) => <UncertaintyCell key={category} category={category} data={data} />)}
        </div>
      </Panel.Body>
    </Panel>
  );
}

export function UncertaintyHeatmap({ models, selectedModelId, onModelChange, modelsLoading, className }: UncertaintyHeatmapProps) {
  // An empty model id skips the fetch.
  const { analysis, isLoading } = useUncertaintyAnalysis(selectedModelId || '');
  const noModels = !modelsLoading && models.length === 0;

  let body: React.ReactNode;
  if (!selectedModelId) {
    body = (
      <Panel>
        <EmptyState
          icon={<BarChart3 />}
          title={noModels ? 'No model to analyse yet' : 'Choose a model'}
          description={
            noModels
              ? 'Uncertainty comes from a trained model\'s predictions. Train and deploy a model, then come back here.'
              : 'Pick a model to see where its predictions are least certain, by task and environment.'
          }
        />
      </Panel>
    );
  } else if (isLoading) {
    body = <Panel padding="none"><SkeletonRows rows={4} columns={3} /></Panel>;
  } else if (!analysis) {
    body = (
      <Panel>
        <EmptyState
          icon={<BarChart3 />}
          title="No uncertainty data"
          description="This needs prediction logs from the model. Deploy it and run predictions to generate data."
        />
      </Panel>
    );
  } else {
    body = (
      <>
        <StatRow columns={4}>
          <StatTile
            label="Overall uncertainty" value={(analysis.overallUncertainty * 100).toFixed(1)} unit="%"
            tone={uncertaintyTone(analysis.overallUncertainty)}
            hint={<span className="inline-flex items-center gap-1">Lower is better <InfoIcon content="Average prediction uncertainty across all task categories and environments." /></span>}
          />
          <StatTile label="Predictions" value={analysis.totalPredictions.toLocaleString(UI_DATE_LOCALE)} />
          <StatTile
            label="Highly uncertain" value={analysis.highUncertaintyCount.toLocaleString(UI_DATE_LOCALE)}
            tone={analysis.highUncertaintyCount > 0 ? 'gated' : undefined}
            hint={`Above the ${(analysis.highUncertaintyThreshold * 100).toFixed(0)}% threshold`}
          />
          <StatTile label="Threshold" value={(analysis.highUncertaintyThreshold * 100).toFixed(0)} unit="%" />
        </StatRow>
        <CategoryGrid title="By task category" entries={Object.entries(analysis.byTask)} />
        <CategoryGrid title="By environment" entries={Object.entries(analysis.byEnvironment)} />
        <p className="text-xs text-ink-tertiary">
          Bars: under 30% is low, 30–70% needs attention, over 70% is critical.
        </p>
      </>
    );
  }

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <ModelSelector models={models} selectedModelId={selectedModelId} onChange={onModelChange} loading={modelsLoading} />
      {body}
    </div>
  );
}
