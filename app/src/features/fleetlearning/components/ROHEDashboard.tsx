/**
 * @file ROHEDashboard.tsx
 * @description Return on Human Effort: how much the model improved per human
 *              intervention, fleet-wide, per robot and per task
 * @feature fleetlearning
 */

import { TrendingUp } from 'lucide-react';
import {
  DataTable, EmptyState, ErrorState, Panel, SkeletonRows, StatRow, StatTile, type DataTableColumn,
} from '@/shared/components/ui';
import { UI_DATE_LOCALE } from '@/shared/utils/format';
import type { ROHEMetrics } from '../types/fleetlearning.types';

export interface ROHEDashboardProps {
  metrics: ROHEMetrics | null;
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** Maps a robot id to its name. */
  robotName?: (robotId: string) => string;
  className?: string;
}

interface Row {
  id: string;
  interventions: number;
  improvement: number;
  rohe: number;
}

const pct = (v: number) => `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)} %`;

function breakdownColumns(header: string, name: (id: string) => string): DataTableColumn<Row>[] {
  return [
    { key: 'id', header, cell: (r) => <span className="font-medium text-ink-primary">{name(r.id)}</span> },
    { key: 'interventions', header: 'Interventions', align: 'right', sortable: true, hideBelow: 'sm' },
    {
      key: 'improvement', header: 'Improvement', align: 'right', sortable: true,
      cell: (r) => <span className={r.improvement < 0 ? 'text-signal-stopped' : 'text-ink-primary'}>{pct(r.improvement)}</span>,
    },
    { key: 'rohe', header: 'ROHE', align: 'right', sortable: true, cell: (r) => r.rohe.toFixed(4) },
  ];
}

const toRows = (rec: ROHEMetrics['byRobot']): Row[] => Object.entries(rec).map(([id, d]) => ({ id, ...d }));

export function ROHEDashboard({ metrics, isLoading = false, error, onRetry, robotName, className }: ROHEDashboardProps) {
  if (isLoading && !metrics) return <Panel className={className}><SkeletonRows rows={4} /></Panel>;
  if (error && !metrics) {
    return <Panel className={className}><ErrorState title="Couldn't load ROHE metrics" message={error} onRetry={onRetry} /></Panel>;
  }
  if (!metrics) {
    return (
      <Panel className={className}>
        <EmptyState icon={<TrendingUp />} title="No ROHE metrics yet"
          description="Interventions during rounds are counted here once robots report them." />
      </Panel>
    );
  }

  // An empty period comes back as the epoch; say nothing rather than "1/1/1970".
  const hasPeriod = new Date(metrics.period.start).getTime() > 0;
  const period = !hasPeriod ? 'No interventions recorded' : `${new Date(metrics.period.start).toLocaleDateString(UI_DATE_LOCALE)} – ${new Date(metrics.period.end).toLocaleDateString(UI_DATE_LOCALE)}`;
  const robotRows = toRows(metrics.byRobot);
  const taskRows = toRows(metrics.byTask);

  return (
    <div className={className ? `flex flex-col gap-6 ${className}` : 'flex flex-col gap-6'}>
      <StatRow columns={4}>
        <StatTile label="Interventions" value={metrics.totalInterventions.toLocaleString(UI_DATE_LOCALE)} hint={period} />
        <StatTile label="Performance gain" value={pct(metrics.performanceImprovement)}
          tone={metrics.performanceImprovement > 0 ? 'live' : metrics.performanceImprovement < 0 ? 'stopped' : undefined}
          hint="Across the period" />
        <StatTile label="ROHE score" value={metrics.improvementPerIntervention.toFixed(3)} hint="Gain per intervention" />
        <StatTile label="Robots" value={robotRows.length} hint="With interventions" />
      </StatRow>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel padding="none">
          <Panel.Header title="By robot" />
          <DataTable caption="ROHE by robot" rows={robotRows} getRowId={(r) => r.id}
            columns={breakdownColumns('Robot', (id) => robotName?.(id) ?? id)}
            defaultSort={{ key: 'rohe', direction: 'desc' }}
            empty={<EmptyState size="sm" title="No robot data yet" />} />
        </Panel>
        <Panel padding="none">
          <Panel.Header title="By task" />
          <DataTable caption="ROHE by task" rows={taskRows} getRowId={(r) => r.id}
            columns={breakdownColumns('Task', (id) => id)}
            defaultSort={{ key: 'rohe', direction: 'desc' }}
            empty={<EmptyState size="sm" title="No task data yet" />} />
        </Panel>
      </div>
    </div>
  );
}
