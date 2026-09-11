/**
 * @file ViewBanner.tsx
 * @description One-line inset note on a view's episode page: whose episodes, how many, and whether it is frozen
 * @feature training
 */

import { Link } from 'react-router-dom';
import { Copy, GitFork, Lock } from 'lucide-react';
import { Button, Panel, StatusTag } from '@/shared/components/ui';
import { describeSelectionOrigin } from '../../types';
import type { Dataset } from '../../types';

export interface ViewBannerProps {
  dataset: Dataset;
  parent: Dataset | null;
  /** Fork the frozen view again; shown only when frozen. */
  onDuplicate?: () => void;
}

export function ViewBanner({ dataset, parent, onDuplicate }: ViewBannerProps) {
  const selected = dataset.selection?.episodes.length ?? dataset.demonstrationCount;
  const frozen = !!dataset.frozenAt;
  return (
    <Panel variant="inset" padding="sm" data-testid="view-banner" className="flex flex-wrap items-center gap-3">
      <GitFork className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.75} />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-ink-primary">
          A view of{' '}
          {dataset.parentDatasetId ? (
            <Link to={`/datasets/${dataset.parentDatasetId}/episodes`} className="font-medium text-primary hover:underline">
              {parent?.name ?? 'its parent dataset'}
            </Link>
          ) : (
            <span className="font-medium">its parent dataset</span>
          )}
        </p>
        <p className="text-xs text-ink-tertiary">
          {parent ? `${selected} of ${parent.demonstrationCount} episodes` : `${selected} episodes selected`}
          {dataset.selection ? ` · ${describeSelectionOrigin(dataset.selection.origin)}` : ''}
          {' · no files were copied'}
        </p>
      </div>
      {frozen && (
        <StatusTag tone="gated" data-testid="view-banner-frozen">
          <Lock className="h-3 w-3" strokeWidth={1.75} /> Frozen — a training run cites this selection
        </StatusTag>
      )}
      {frozen && onDuplicate && (
        <Button
          variant="ghost"
          size="sm"
          data-testid="view-banner-duplicate"
          leftIcon={<Copy className="h-4 w-4" strokeWidth={1.75} />}
          onClick={onDuplicate}
        >
          Duplicate as new view
        </Button>
      )}
    </Panel>
  );
}
