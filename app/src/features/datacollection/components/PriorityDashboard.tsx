/**
 * @file PriorityDashboard.tsx
 * @description Priorities tab of /data-collection: which tasks and
 *              environments need more demonstrations, per model.
 * @feature datacollection
 */

import { Target } from 'lucide-react';
import {
  EmptyState, Panel, ProgressBar, SkeletonRows, StatRow, StatTile, StatusTag, InfoIcon, type StatusTagTone,
} from '@/shared/components/ui';
import type { CollectionPriority } from '../types/datacollection.types';
import { TARGET_TYPE_LABELS, getPriorityLabel } from '../types/datacollection.types';
import type { RegisteredModel } from '@/features/training/types';
import { ModelSelector } from './ModelSelector';

export interface PriorityDashboardProps {
  priorities: CollectionPriority[];
  isLoading?: boolean;
  onTargetClick?: (priority: CollectionPriority) => void;
  models?: RegisteredModel[];
  selectedModelId?: string | null;
  onModelChange?: (modelId: string | null) => void;
  modelsLoading?: boolean;
  className?: string;
}

function priorityTone(score: number): StatusTagTone {
  if (score >= 0.8) return 'danger';
  if (score >= 0.4) return 'warning';
  return 'neutral';
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

function PriorityCard({ priority, onClick }: { priority: CollectionPriority; onClick?: () => void }) {
  const progress = priority.estimatedDemosNeeded > 0
    ? Math.min(100, (priority.currentDemoCount / priority.estimatedDemosNeeded) * 100)
    : 0;
  return (
    <Panel interactive={!!onClick} onClick={onClick} padding="sm" className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-ink-tertiary">{TARGET_TYPE_LABELS[priority.targetType]}</div>
          <div className="truncate text-sm font-semibold text-ink-primary">{priority.target}</div>
        </div>
        <StatusTag tone={priorityTone(priority.priorityScore)} dot>
          {getPriorityLabel(priority.priorityScore)} · {pct(priority.priorityScore)}
        </StatusTag>
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex justify-between text-xs text-ink-tertiary">
          <span>{priority.currentDemoCount} collected</span>
          <span>{priority.estimatedDemosNeeded} needed</span>
        </div>
        <ProgressBar value={progress} size="sm" showValue={false} label={`${priority.target} progress`} />
      </div>
      <dl className="grid grid-cols-3 gap-2 text-xs">
        {([['Uncertainty', priority.uncertaintyComponent], ['Diversity', priority.diversityComponent], ['Progress', priority.progressComponent]] as const).map(([label, v]) => (
          <div key={label} className="rounded-control bg-inset px-2 py-1.5">
            <dt className="text-ink-tertiary">{label}</dt>
            <dd className="font-medium tabular-nums text-ink-primary">{pct(v)}</dd>
          </div>
        ))}
      </dl>
      <p className="text-[13px] text-ink-secondary">{priority.recommendation}</p>
    </Panel>
  );
}

export function PriorityDashboard({
  priorities, isLoading, onTargetClick, models, selectedModelId, onModelChange, modelsLoading, className,
}: PriorityDashboardProps) {
  const totalNeeded = priorities.reduce((sum, p) => sum + p.estimatedDemosNeeded, 0);
  const totalCollected = priorities.reduce((sum, p) => sum + p.currentDemoCount, 0);
  const noModels = !modelsLoading && (models?.length ?? 0) === 0;

  return (
    <div className={className ? `flex flex-col gap-4 ${className}` : 'flex flex-col gap-4'}>
      {models && onModelChange && (
        <ModelSelector models={models} selectedModelId={selectedModelId ?? null} onChange={onModelChange} loading={modelsLoading} />
      )}

      {isLoading ? (
        <Panel padding="none"><SkeletonRows rows={4} columns={3} /></Panel>
      ) : priorities.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<Target />}
            title="No collection priorities yet"
            description={
              noModels
                ? 'Priorities come from a trained model\'s uncertainty. Train a model first, then come back to see where it needs more demonstrations.'
                : selectedModelId
                  ? 'This model has no priorities yet. They are generated from its prediction uncertainty.'
                  : 'Choose a model to see which tasks need more demonstrations.'
            }
          />
        </Panel>
      ) : (
        <>
          <StatRow columns={3}>
            <StatTile
              label="High priority" value={priorities.filter((p) => p.priorityScore >= 0.6).length} tone="gated"
              hint={<span className="inline-flex items-center gap-1">Score of 60% or more <InfoIcon content="These targets need the most additional demonstrations." /></span>}
            />
            <StatTile label="Targets" value={priorities.length} />
            <StatTile
              label="Collected" value={totalNeeded > 0 ? Math.round((totalCollected / totalNeeded) * 100) : 0} unit="%"
              hint={`${totalCollected} of ${totalNeeded} demos`}
            />
          </StatRow>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {priorities.map((priority, idx) => (
              <PriorityCard
                key={`${priority.targetType}-${priority.target}-${idx}`}
                priority={priority}
                onClick={onTargetClick ? () => onTargetClick(priority) : undefined}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
