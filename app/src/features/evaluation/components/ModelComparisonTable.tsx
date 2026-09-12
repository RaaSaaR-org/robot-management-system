/**
 * @file ModelComparisonTable.tsx
 * @description Two model versions side by side: success rate, episodes, duration, top error
 * @feature evaluation
 */

import { GitCompareArrows } from 'lucide-react';
import { DataTable, EmptyState, SkeletonRows, StatusTag, type DataTableColumn } from '@/shared/components/ui';
import type { ModelComparisonResult } from '../types';

export interface ModelComparisonTableProps {
  comparison: ModelComparisonResult | null;
  loading?: boolean;
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

interface Row {
  metric: string;
  a: string;
  b: string;
  better: 'a' | 'b' | null;
}

export function ModelComparisonTable({ comparison, loading }: ModelComparisonTableProps) {
  if (loading) return <SkeletonRows rows={4} columns={3} dense />;
  if (!comparison) {
    return (
      <EmptyState
        size="sm"
        icon={<GitCompareArrows />}
        title="Nothing to compare yet"
        description="A comparison appears once two model versions have evaluation episodes in this period."
      />
    );
  }

  const { versionA: A, versionB: B } = comparison;
  const rows: Row[] = [
    { metric: 'Success rate', a: `${A.successRate.toFixed(1)}%`, b: `${B.successRate.toFixed(1)}%`, better: A.successRate > B.successRate ? 'a' : B.successRate > A.successRate ? 'b' : null },
    { metric: 'Episodes', a: String(A.totalEpisodes), b: String(B.totalEpisodes), better: null },
    { metric: 'Avg duration', a: formatDuration(A.avgDurationMs), b: formatDuration(B.avgDurationMs), better: A.avgDurationMs < B.avgDurationMs ? 'a' : B.avgDurationMs < A.avgDurationMs ? 'b' : null },
    { metric: 'Top error', a: A.errorBreakdown[0]?.errorType ?? 'None', b: B.errorBreakdown[0]?.errorType ?? 'None', better: null },
  ];

  const cell = (side: 'a' | 'b') => (r: Row) =>
    r.better === side ? (
      <span className="inline-flex items-center gap-2 font-medium text-ink-primary">
        {r[side]} <StatusTag tone="success" size="sm">Better</StatusTag>
      </span>
    ) : (
      <span className="text-ink-secondary">{r[side]}</span>
    );

  const columns: DataTableColumn<Row>[] = [
    { key: 'metric', header: 'Metric' },
    { key: 'a', header: A.modelVersion, cell: cell('a') },
    { key: 'b', header: B.modelVersion, cell: cell('b') },
  ];

  return <DataTable caption="Model comparison" columns={columns} rows={rows} getRowId={(r) => r.metric} dense />;
}
