/**
 * @file DatasetNameCell.tsx
 * @description Name cell of the dataset table: name, origin line, tags and the warnings a row carries
 * @feature training
 */

import { AlertTriangle, CameraOff, Lock } from 'lucide-react';
import { StatusTag, Tooltip } from '@/shared/components/ui';
import { describeSelectionOrigin, isDatasetView } from '../../types';
import type { Dataset, DatasetParentSummary } from '../../types';

export interface DatasetNameCellProps {
  dataset: Dataset;
  /** The parent of a view, resolved out of the list already loaded. */
  parent?: DatasetParentSummary | null;
}

/** The second line under a dataset's name: what it is made of. */
export function datasetOriginLine(dataset: Dataset, parent?: DatasetParentSummary | null): string {
  if (isDatasetView(dataset)) {
    const viewParent = parent ?? dataset.parent ?? null;
    const selected = dataset.selection?.episodes.length ?? dataset.demonstrationCount;
    const count =
      viewParent?.demonstrationCount !== undefined
        ? `${selected} of ${viewParent.demonstrationCount} episodes`
        : `${selected} episodes selected`;
    const rule = dataset.selection ? ` · ${describeSelectionOrigin(dataset.selection.origin)}` : '';
    return `View of ${viewParent?.name ?? 'another dataset'} · ${count}${rule}`;
  }
  if (dataset.huggingFaceRepoId) return dataset.huggingFaceRepoId;
  return dataset.description ?? `LeRobot ${dataset.lerobotVersion}`;
}

export function DatasetNameCell({ dataset, parent }: DatasetNameCellProps) {
  const isView = isDatasetView(dataset);
  const isFrozen = isView && !!dataset.frozenAt;
  const isSynthetic = !!dataset.infoJson?._synthetic;
  const validation = dataset.validation;
  const noImages = validation?.warnings.some((w) => w.code === 'NO_IMAGE_FEATURES') ?? false;
  const problems = validation?.errors ?? [];

  return (
    <div className="flex w-[11rem] min-w-0 flex-col gap-1 sm:w-auto sm:max-w-md">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span className="truncate text-sm font-medium text-ink-primary">{dataset.name}</span>
        {isView && (
          <StatusTag tone="accent" data-testid="dataset-view-badge">
            View
          </StatusTag>
        )}
        {isFrozen && (
          <Tooltip content="A training run cites this view, so its selection can no longer change.">
            <span className="inline-flex text-ink-tertiary" aria-label="Frozen">
              <Lock className="h-3.5 w-3.5" strokeWidth={1.75} />
            </span>
          </Tooltip>
        )}
        {isSynthetic && <StatusTag tone="sim">Synthetic</StatusTag>}
        {dataset.importMode === 'metadata' && <StatusTag tone="gated">Metadata only</StatusTag>}
        {noImages && (
          <Tooltip content="No camera features — a VLA policy cannot train on this.">
            <span className="inline-flex text-signal-estimated" aria-label="No camera features">
              <CameraOff className="h-3.5 w-3.5" strokeWidth={1.75} />
            </span>
          </Tooltip>
        )}
        {problems.length > 0 && (
          <Tooltip content={problems[0]!.message}>
            <span className="inline-flex text-signal-stopped" aria-label={`${problems.length} structural problems`}>
              <AlertTriangle className="h-3.5 w-3.5" strokeWidth={1.75} />
            </span>
          </Tooltip>
        )}
      </div>
      <span className="truncate text-[13px] text-ink-tertiary" title={datasetOriginLine(dataset, parent)}>
        {datasetOriginLine(dataset, parent)}
      </span>
    </div>
  );
}
