/**
 * @file DatasetCompatibilityPanel.tsx
 * @description Side-by-side compatibility report for a selection of datasets
 * @feature training
 *
 * The report is a comparison, so it is drawn as one: an axis per row, a dataset
 * per column, the differing cell visible without reading a sentence about it.
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

      <div className="overflow-x-auto rounded-panel border border-line">
        <table className="w-full min-w-[32rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line bg-inset text-left">
              <th scope="col" className="px-3 py-2 text-xs font-medium text-ink-tertiary">Axis</th>
              {columns.map((c) => (
                <th key={c.datasetId} scope="col" className="px-3 py-2 text-xs font-medium text-ink-primary">{c.datasetName}</th>
              ))}
              <th scope="col" className="px-3 py-2 text-xs font-medium text-ink-tertiary">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {report.axes.map((axis) => (
              <tr key={axis.axis} data-testid={`compatibility-axis-${axis.axis}`} className="border-b border-line-subtle align-top last:border-0">
                <th scope="row" className="px-3 py-2 text-left font-normal text-ink-secondary">
                  {axis.label}
                  <p className="mt-0.5 text-xs text-ink-tertiary">{axis.note}</p>
                </th>
                {columns.map((c) => {
                  const cell = axis.values.find((v) => v.datasetId === c.datasetId);
                  return (
                    <td key={c.datasetId} className={cn('px-3 py-2 tabular-nums', axis.verdict === 'match' ? 'text-ink-secondary' : 'font-medium text-ink-primary')}>
                      {cell ? cell.value : '—'}
                    </td>
                  );
                })}
                <td className="px-3 py-2">
                  <StatusTag tone={AXIS[axis.verdict].tone} size="sm">{AXIS[axis.verdict].label}</StatusTag>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
