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
 * per-embodiment projectors rather than concatenated — that is a supported way
 * to train, and it is coloured like an answer rather than like a warning.
 * `incompatible` is the only verdict that stops anything.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, Layers } from 'lucide-react';
import { Spinner, Button } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { trainingApi } from '../api';
import type { AxisVerdict, CompatibilityReport, CompatibilityVerdict } from '../types';
import { getErrorMessage } from '@/shared/utils';

export interface DatasetCompatibilityPanelProps {
  datasetIds: string[];
  /** Fires with the report (or null while loading / after a failure). */
  onReport?: (report: CompatibilityReport | null) => void;
  className?: string;
}

const verdictStyles: Record<CompatibilityVerdict, { box: string; label: string; icon: typeof Info }> = {
  identical: {
    box: 'border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300',
    label: 'Concatenable',
    icon: CheckCircle2,
  },
  compatible: {
    box: 'border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300',
    label: 'Compatible',
    icon: CheckCircle2,
  },
  multi_embodiment: {
    box: 'border-cobalt-500/40 bg-cobalt-500/10 text-cobalt-700 dark:text-cobalt-300',
    label: 'Multi-embodiment mixture',
    icon: Layers,
  },
  incompatible: {
    box: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
    label: 'Cannot be trained together',
    icon: AlertTriangle,
  },
};

const axisVerdictStyles: Record<AxisVerdict, { chip: string; label: string }> = {
  match: { chip: 'bg-green-500/10 text-green-600 dark:text-green-400', label: 'Same' },
  // Cobalt, not amber: on a multi-embodiment mixture a differing axis is the
  // reason the mixture exists, not something that went wrong.
  differs: { chip: 'bg-cobalt-500/10 text-cobalt-600 dark:text-cobalt-400', label: 'Differs' },
  blocking: { chip: 'bg-red-500/10 text-red-600 dark:text-red-400', label: 'Blocking' },
};

export function DatasetCompatibilityPanel({
  datasetIds,
  onReport,
  className,
}: DatasetCompatibilityPanelProps) {
  const [report, setReport] = useState<CompatibilityReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Held in a ref so a parent that passes an inline arrow does not re-run the
  // request on every one of its renders.
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
    if (ids.length === 0) {
      setReport(null);
      return;
    }
    void load(ids);
  }, [key, load]);

  if (isLoading) {
    return (
      <div className={cn('flex items-center gap-3 py-6', className)}>
        <Spinner size="sm" />
        <span className="text-sm text-theme-secondary">Comparing datasets…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div
        data-testid="compatibility-error"
        className={cn('rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400', className)}
      >
        <p>{error}</p>
        <Button
          variant="ghost"
          size="sm"
          className="mt-2"
          onClick={() => void load(key.split(','))}
        >
          Try again
        </Button>
      </div>
    );
  }

  if (!report) return null;

  const style = verdictStyles[report.verdict] ?? verdictStyles.incompatible;
  const VerdictIcon = style.icon;

  // Column order comes from the first axis that names every dataset, so the
  // table reads in the order the report was built in rather than in id order.
  const columns: Array<{ datasetId: string; datasetName: string }> = [];
  for (const axis of report.axes) {
    for (const value of axis.values) {
      if (!columns.some((c) => c.datasetId === value.datasetId)) {
        columns.push({ datasetId: value.datasetId, datasetName: value.datasetName });
      }
    }
  }

  return (
    <div data-testid="compatibility-panel" className={cn('space-y-4', className)}>
      <div className={cn('rounded-lg border p-4', style.box)}>
        <div className="flex items-start gap-3">
          <VerdictIcon className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="min-w-0">
            <p data-testid="compatibility-verdict" className="text-xs font-semibold uppercase tracking-wide opacity-80">
              {style.label}
            </p>
            <p data-testid="compatibility-headline" className="mt-1 text-base font-medium">
              {report.headline}
            </p>
            <p data-testid="compatibility-recommendation" className="mt-2 text-sm opacity-90">
              {report.recommendation}
            </p>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-theme-secondary/20 text-left">
              <th scope="col" className="py-2 pr-3 font-medium text-theme-tertiary">Axis</th>
              {columns.map((column) => (
                <th
                  key={column.datasetId}
                  scope="col"
                  className="py-2 pr-3 font-medium text-theme-primary"
                >
                  {column.datasetName}
                </th>
              ))}
              <th scope="col" className="py-2 font-medium text-theme-tertiary">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {report.axes.map((axis) => (
              <tr
                key={axis.axis}
                data-testid={`compatibility-axis-${axis.axis}`}
                className="border-b border-theme-secondary/10 align-top"
              >
                <th scope="row" className="py-2 pr-3 text-left font-normal text-theme-secondary">
                  {axis.label}
                  <p className="mt-0.5 text-xs text-theme-tertiary">{axis.note}</p>
                </th>
                {columns.map((column) => {
                  const cell = axis.values.find((v) => v.datasetId === column.datasetId);
                  return (
                    <td
                      key={column.datasetId}
                      className={cn(
                        'py-2 pr-3 font-mono text-xs',
                        axis.verdict === 'match' ? 'text-theme-secondary' : 'text-theme-primary font-medium'
                      )}
                    >
                      {cell ? cell.value : '—'}
                    </td>
                  );
                })}
                <td className="py-2">
                  <span
                    className={cn(
                      'inline-flex rounded px-1.5 py-0.5 text-xs font-medium',
                      axisVerdictStyles[axis.verdict].chip
                    )}
                  >
                    {axisVerdictStyles[axis.verdict].label}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
