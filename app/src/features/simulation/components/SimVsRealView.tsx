/**
 * @file SimVsRealView.tsx
 * @description Sim-to-real gap for a model: success in simulation vs. on a real robot, from logged tests
 * @feature simulation
 */

import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { GitCompareArrows } from 'lucide-react';
import {
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  InfoIcon,
  Input,
  Panel,
  SkeletonText,
  StatusTag,
  chartColors,
  chartTheme,
  type DataTableColumn,
  type Tone,
} from '@/shared/components/ui';
import { getErrorMessage } from '@/shared/utils';
import { simulationApi } from '../api/simulationApi';
import type { SimToRealComparison } from '../types';
import { GLOSSARY, formatPct, formatRelative } from './simFormat';

/** Gap ≤ 10 pp is well calibrated, ≤ 25 pp worth a look, more is a problem. */
function gapTone(gap: number): Tone {
  const pp = Math.abs(gap) * 100;
  return pp <= 10 ? 'success' : pp <= 25 ? 'warning' : 'danger';
}

const sceneLabel = (c: SimToRealComparison, i: number) =>
  c.twinId ? `Scanned room ${i + 1}` : c.simSceneId ? `Scene ${i + 1}` : `Environment ${i + 1}`;

export function SimVsRealView() {
  const [modelId, setModelId] = useState('');
  const [rows, setRows] = useState<SimToRealComparison[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const compare = async () => {
    if (!modelId.trim()) return;
    setLoading(true);
    setError(null);
    try {
      setRows(await simulationApi.getComparison(modelId.trim()));
    } catch (err) {
      setError(getErrorMessage(err, 'Comparison failed'));
    } finally {
      setLoading(false);
    }
  };

  const columns: DataTableColumn<SimToRealComparison & { _i: number }>[] = [
    { key: 'scene', header: 'Scene', cell: (c) => sceneLabel(c, c._i) },
    { key: 'sim', header: 'Sim', align: 'right', cell: (c) => formatPct(c.simSuccessRate) },
    { key: 'real', header: 'Real', align: 'right', cell: (c) => formatPct(c.realSuccessRate) },
    { key: 'gap', header: 'Gap', cell: (c) => <StatusTag tone={gapTone(c.gap)}>{`${c.gap > 0 ? '+' : ''}${(c.gap * 100).toFixed(0)} pp`}</StatusTag> },
    { key: 'n', header: 'Real episodes', align: 'right', hideBelow: 'sm', cell: (c) => c.realTestCount ?? '—' },
    { key: 'date', header: 'Validated', align: 'right', hideBelow: 'md', cell: (c) => (c.validationDate ? formatRelative(c.validationDate) : '—') },
  ];

  const chartData = (rows ?? []).map((c, i) => ({
    name: sceneLabel(c, i),
    Simulation: Math.round(c.simSuccessRate * 100),
    Real: Math.round(c.realSuccessRate * 100),
  }));

  return (
    <div className="flex flex-col gap-6">
      <Panel>
        <Panel.Header
          title={<span className="inline-flex items-center gap-1.5">Sim vs real <InfoIcon content={GLOSSARY.simToReal} /></span>}
          description="Measured from logged real-robot test runs, never estimated."
        />
        <Panel.Body>
          <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void compare(); }}>
            <div className="min-w-0 flex-1 sm:max-w-sm">
              <Input aria-label="Model ID" value={modelId} onChange={(e) => setModelId(e.target.value)} placeholder="Model ID, e.g. smolvla-so101-v2" />
            </div>
            <Button type="submit" variant="secondary" isLoading={loading} disabled={!modelId.trim()} leftIcon={<GitCompareArrows className="h-4 w-4" />}>
              Compare
            </Button>
          </form>
        </Panel.Body>
      </Panel>

      {error ? (
        <Panel><ErrorState title="Couldn't compare" message={error} onRetry={() => void compare()} /></Panel>
      ) : loading && !rows ? (
        <Panel><SkeletonText lines={4} /></Panel>
      ) : rows === null ? null : rows.length === 0 ? (
        <Panel>
          <EmptyState icon={<GitCompareArrows />} title="Not validated on a real robot yet" description={`No sim-to-real validation is logged for ${modelId}. The gap appears once a real test run is logged against a sim scene.`} />
        </Panel>
      ) : (
        <>
          <Panel>
            <Panel.Header title="Success rate, sim and real" />
            <Panel.Body>
              <div className="h-72 w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                  <BarChart data={chartData} barGap={6}>
                    <CartesianGrid {...chartTheme.grid} />
                    <XAxis dataKey="name" {...chartTheme.xAxis} />
                    <YAxis domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} {...chartTheme.yAxis} width={44} />
                    <Tooltip {...chartTheme.tooltip} formatter={(v) => `${v}%`} />
                    <Legend {...chartTheme.legend} />
                    <Bar dataKey="Simulation" fill={chartColors.estimated} radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Real" fill={chartColors.measured} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel.Body>
          </Panel>
          <Panel padding="none">
            <DataTable caption="Sim-to-real validations" columns={columns} rows={rows.map((r, i) => ({ ...r, _i: i }))} getRowId={(r) => r.simSceneId ?? r.twinId ?? `row-${r._i}`} />
          </Panel>
        </>
      )}
    </div>
  );
}
