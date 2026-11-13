/**
 * @file DatasetCompatibilityPanel.tsx
 * @description Side-by-side compatibility report for a selection of datasets
 * @feature training
 *
 * The report is a comparison, so it is drawn as one: an axis per row, a dataset
 * per column, the differing cell visible without reading a sentence about it.
 *
 * The per-axis verdict sits directly after the axis, ahead of the dataset
 * columns, and both stay pinned while the dataset columns scroll: with three
 * datasets the verdict column used to be 300 px off the right edge of the
 * dialog (TASK-486). Dataset names are cut with an ellipsis and keep the full
 * name in `title`.
 *
 * The verdict is not a severity scale. `multi_embodiment` means the datasets
 * have different action spaces and must be trained as a mixture with
 * per-embodiment projectors rather than concatenated — a supported way to
 * train, so it reads as information, not as a warning. `incompatible` is the
 * only verdict that stops anything.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, Layers } from 'lucide-react';
import { ErrorState, SkeletonText, StatusTag, type StatusTagTone } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { getErrorMessage } from '@/shared/utils';
import { trainingApi } from '../api';
import type { AxisVerdict, CompatibilityReport, CompatibilityVerdict } from '../types';

export interface DatasetCompatibilityPanelProps {
  datasetIds: string[];
  /** Fires with the report (or null while loading / after a failure). */
  onReport?: (report: CompatibilityReport | null) => void;
  className?: string;
}

type VerdictTone = 'success' | 'info' | 'danger';

const VERDICT: Record<CompatibilityVerdict, { tone: VerdictTone; label: string; icon: typeof Info }> = {
  identical: { tone: 'success', label: 'Concatenable', icon: CheckCircle2 },
  compatible: { tone: 'success', label: 'Compatible', icon: CheckCircle2 },
  multi_embodiment: { tone: 'info', label: 'Multi-embodiment mixture', icon: Layers },
  incompatible: { tone: 'danger', label: 'Cannot be trained together', icon: AlertTriangle },
};

const TONE_BOX: Record<VerdictTone, string> = {
  success: 'border-signal-measured/40 text-signal-measured',
  info: 'border-signal-estimated/40 text-ink-primary',
  danger: 'border-signal-stopped/40 text-signal-stopped',
};

// A differing axis on a mixture is the reason the mixture exists, so it is
// information (info), not a warning.
const AXIS: Record<AxisVerdict, { tone: StatusTagTone; label: string }> = {
  match: { tone: 'success', label: 'Same' },
  differs: { tone: 'info', label: 'Differs' },
  blocking: { tone: 'danger', label: 'Blocking' },
};

// The axis and its verdict are pinned to the left edge; the dataset columns
// scroll under them. Widths are fixed so the second pin knows where to sit.
const HEAD_CELL = 'border-b border-line px-3 py-2 text-xs font-medium';
const BODY_CELL = 'border-b border-line-subtle px-3 py-2';
const STICKY_AXIS = 'sticky left-0 z-10 w-44';
const STICKY_VERDICT = 'sticky left-44 z-10 w-24 border-r border-r-line-subtle';
/** w-44 + w-24, and the least a dataset column is squeezed to before the table scrolls. */
const PINNED_REM = 17;
const DATASET_COLUMN_REM = 9;

export function DatasetCompatibilityPanel({ datasetIds, onReport, className }: DatasetCompatibilityPanelProps) {
  const [report, setReport] = useState<CompatibilityReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A ref so a parent passing an inline arrow does not re-run the request.
  const onReportRef = useRef(onReport);
  onReportRef.current = onReport;
  const key = datasetIds.join(',');

  const load = useCallback(async (ids: string[]) => {
    setIsLoading(true);
    setError(null);
    onReportRef.current?.(null);
    try {
      const result = await trainingApi.checkCompatibility(ids);
      setReport(result);
      onReportRef.current?.(result);
    } catch (err) {
      setReport(null);
      setError(getErrorMessage(err, 'Could not compare these datasets'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const ids = key ? key.split(',') : [];
    if (ids.length === 0) { setReport(null); return; }
    void load(ids);
  }, [key, load]);

  if (isLoading) {
    return (
      <div className={cn('flex flex-col gap-2 py-2', className)} aria-busy="true">
        <p className="text-sm text-ink-secondary">Comparing datasets…</p>
        <SkeletonText lines={4} />
      </div>
    );
  }

  if (error) {
    return (
      <div data-testid="compatibility-error" className={className}>
        <ErrorState size="sm" title="Couldn't compare these datasets" message={error} retryLabel="Try again" onRetry={() => void load(key.split(','))} />
      </div>
    );
  }

  if (!report) return null;

  const verdict = VERDICT[report.verdict] ?? VERDICT.incompatible;
  const VerdictIcon = verdict.icon;

  // Column order from the first axis that names every dataset.
  const columns: Array<{ datasetId: string; datasetName: string }> = [];
  for (const axis of report.axes) {
    for (const value of axis.values) {
      if (!columns.some((c) => c.datasetId === value.datasetId)) {
        columns.push({ datasetId: value.datasetId, datasetName: value.datasetName });
      }
    }
  }

  return (
    <div data-testid="compatibility-panel" className={cn('flex flex-col gap-4', className)}>
      <div data-tone={verdict.tone} className={cn('flex items-start gap-3 rounded-panel border bg-inset p-4', TONE_BOX[verdict.tone])}>
        <VerdictIcon className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={1.75} />
        <div className="min-w-0">
          <p data-testid="compatibility-verdict" className="text-xs font-semibold">{verdict.label}</p>
          <p data-testid="compatibility-headline" className="mt-1 text-base font-medium text-ink-primary">{report.headline}</p>
          <p data-testid="compatibility-recommendation" className="mt-2 text-sm text-ink-secondary">{report.recommendation}</p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-panel border border-line" data-testid="compatibility-table-scroll">
        {/* Fixed layout: the dataset columns share what is left of the dialog, so
            three of them fit a 1280 px screen without scrolling; from there each
            added dataset is guaranteed DATASET_COLUMN_REM and the table scrolls. */}
        <table
          className="w-full table-fixed border-separate border-spacing-0 text-sm"
          style={{ minWidth: `${PINNED_REM + columns.length * DATASET_COLUMN_REM}rem` }}
        >
          <thead>
            <tr className="text-left">
              <th scope="col" className={cn(HEAD_CELL, STICKY_AXIS, 'bg-inset text-ink-tertiary')}>Axis</th>
              <th scope="col" className={cn(HEAD_CELL, STICKY_VERDICT, 'bg-inset text-ink-tertiary')}>Verdict</th>
              {columns.map((c) => (
                <th key={c.datasetId} scope="col" title={c.datasetName} className={cn(HEAD_CELL, 'bg-inset text-ink-primary')}>
                  <span className="block truncate">{c.datasetName}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.axes.map((axis) => (
              <tr key={axis.axis} data-testid={`compatibility-axis-${axis.axis}`} className="align-top [&:last-child>*]:border-b-0">
                <th scope="row" className={cn(BODY_CELL, STICKY_AXIS, 'bg-raised text-left font-normal text-ink-secondary')}>
                  {axis.label}
                  <p className="mt-0.5 text-xs text-ink-tertiary">{axis.note}</p>
                </th>
                <td className={cn(BODY_CELL, STICKY_VERDICT, 'bg-raised')} data-testid={`compatibility-axis-verdict-${axis.axis}`}>
                  <StatusTag tone={AXIS[axis.verdict].tone} size="sm">{AXIS[axis.verdict].label}</StatusTag>
                </td>
                {columns.map((c) => {
                  const cell = axis.values.find((v) => v.datasetId === c.datasetId);
                  return (
                    <td key={c.datasetId} className={cn(BODY_CELL, 'tabular-nums [overflow-wrap:anywhere]', axis.verdict === 'match' ? 'text-ink-secondary' : 'font-medium text-ink-primary')}>
                      {cell ? cell.value : '—'}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
