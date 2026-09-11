/**
 * @file ModelVersionCard.tsx
 * @description Card for one model version — headline, status, source and
 *              lineage link; used by the training "init from model" picker
 * @feature deployment
 */

import { Link2 } from 'lucide-react';
import { Badge, Panel, StatusTag } from '@/shared/components/ui';
import { UI_DATE_LOCALE, cn } from '@/shared/utils';
import { useModelVersionFromStore } from '../hooks/useModelVersions';
import { MODEL_SOURCE_KIND_LABELS } from '../types';
import type { ModelVersion } from '../types';
import { getModelDisplayName } from './models/modelDisplay';

export interface ModelVersionCardProps {
  version: ModelVersion;
  onClick?: () => void;
  selected?: boolean;
  compact?: boolean;
  className?: string;
}

export function ModelVersionCard({ version, onClick, selected, compact = false, className }: ModelVersionCardProps) {
  const formattedDate = new Date(version.createdAt).toLocaleDateString(UI_DATE_LOCALE);
  const parentFromStore = useModelVersionFromStore(version.parentModelVersionId);
  const parent = version.parent ?? parentFromStore;
  const m = version.metrics;
  const metrics = !compact && m
    ? [
        m.accuracy !== undefined && { label: 'Accuracy', value: `${(m.accuracy * 100).toFixed(1)} %` },
        m.latencyP50 !== undefined && { label: 'P50 latency', value: `${m.latencyP50} ms` },
        m.successRate !== undefined && { label: 'Success', value: `${(m.successRate * 100).toFixed(1)} %` },
      ].filter((x): x is { label: string; value: string } => Boolean(x))
    : [];

  return (
    <Panel
      id={`model-${version.id}`}
      interactive={Boolean(onClick)}
      onClick={onClick}
      padding={compact ? 'sm' : 'md'}
      aria-pressed={onClick ? Boolean(selected) : undefined}
      className={cn('flex flex-col', compact ? 'gap-2' : 'gap-3', selected && 'border-primary bg-primary/10', className)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-ink-primary">{getModelDisplayName(version)}</div>
          <div className="truncate text-[13px] text-ink-tertiary">v{version.version}</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <StatusTag status={version.deploymentStatus} size="sm" />
          {version.sourceKind && (
            <Badge variant="neutral" size="sm">{MODEL_SOURCE_KIND_LABELS[version.sourceKind]}</Badge>
          )}
        </div>
      </div>

      {version.parentModelVersionId && (
        <a
          href={`#model-${version.parentModelVersionId}`}
          onClick={(e) => e.stopPropagation()}
          className="flex items-center gap-1 truncate text-xs text-primary hover:underline"
        >
          <Link2 className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
          <span className="truncate">
            Derived from {parent ? getModelDisplayName(parent) : `model ${version.parentModelVersionId.slice(0, 8)}`}
          </span>
        </a>
      )}

      {metrics.length > 0 && (
        <div className="grid grid-cols-3 gap-2 text-center">
          {metrics.map((x) => (
            <div key={x.label} className="rounded-control bg-inset p-2">
              <div className="text-sm font-semibold text-ink-primary">{x.value}</div>
              <div className="text-xs text-ink-tertiary">{x.label}</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-ink-tertiary">
        <span>Created {formattedDate}</span>
        {version.deploymentStatus === 'staging' && <span className="text-ink-secondary">Ready to deploy</span>}
      </div>
    </Panel>
  );
}
