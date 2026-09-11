/**
 * @file DeploymentOverview.tsx
 * @description Overview tab of a deployment: canary stages with their state, and the rollout details
 * @feature deployment
 */

import { Badge, Divider, KeyValueList, Panel, ProgressBar, StatusTag } from '@/shared/components/ui';
import { cn, formatDateTime } from '@/shared/utils';
import type { Deployment } from '../types';
import { formatStageDuration, reachedStages, strategyLabel } from './deploymentHelpers';

export interface DeploymentOverviewProps {
  deployment: Deployment;
}

function stageState(index: number, reached: number, d: Deployment): 'completed' | 'in_progress' | 'pending' {
  const moving = d.status === 'deploying' || d.status === 'canary';
  if (index < reached - (moving ? 1 : 0)) return 'completed';
  if (moving && index === Math.max(reached - 1, 0)) return 'in_progress';
  return index < reached ? 'completed' : 'pending';
}

function Tags({ values }: { values?: string[] }) {
  if (!values || values.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {values.map((v) => <Badge key={v} size="sm">{v}</Badge>)}
    </span>
  );
}

export function DeploymentOverview({ deployment: d }: DeploymentOverviewProps) {
  const stages = d.canaryConfig?.stages ?? [];
  const reached = reachedStages(d);
  const t = d.rollbackThresholds;

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
      <Panel className="xl:col-span-2">
        <Panel.Header
          title={stages.length > 0 ? 'Canary stages' : 'Rollout'}
          description={stages.length > 0 ? 'Traffic moves to the next stage once the current one stays healthy.' : undefined}
        />
        <Panel.Body className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <ProgressBar value={d.trafficPercentage} showValue={false} className="flex-1" />
            <span className="w-12 text-right text-sm tabular-nums text-ink-primary">{d.trafficPercentage}%</span>
          </div>
          {stages.length > 0 && (
            <ol className="flex flex-col gap-2">
              {stages.map((s, i) => {
                const state = stageState(i, reached, d);
                return (
                  <li
                    key={i}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-control bg-inset px-3 py-2.5"
                  >
                    <span
                      aria-hidden
                      className={cn('h-2 w-2 shrink-0 rounded-full', state === 'in_progress' ? 'bg-primary' : 'bg-line-strong')}
                    />
                    <span className="min-w-[4.5rem] text-sm font-medium text-ink-primary">Stage {i + 1}</span>
                    <span className="min-w-[3rem] text-sm tabular-nums text-ink-secondary">{s.percentage}%</span>
                    <span className="flex-1 text-[13px] text-ink-tertiary">{formatStageDuration(s.durationMinutes)}</span>
                    <StatusTag status={state} />
                  </li>
                );
              })}
            </ol>
          )}
        </Panel.Body>
      </Panel>

      <Panel>
        <Panel.Header title="Details" />
        <Panel.Body className="flex flex-col gap-4">
          <KeyValueList
            columns={1}
            items={[
              { label: 'Strategy', value: strategyLabel(d.strategy) },
              { label: 'Model version', value: d.modelVersionId, mono: true },
              { label: 'Created', value: formatDateTime(d.createdAt) },
              { label: 'Started', value: d.startedAt ? formatDateTime(d.startedAt) : undefined },
              { label: 'Completed', value: d.completedAt ? formatDateTime(d.completedAt) : undefined },
              { label: 'Robot types', value: <Tags values={d.targetRobotTypes} /> },
              { label: 'Zones', value: d.targetZones?.length ? <Tags values={d.targetZones} /> : 'All zones' },
            ]}
          />
          {t && (
            <>
              <Divider label="Rollback thresholds" />
              <KeyValueList
                columns={1}
                items={[
                  { label: 'Error rate', value: `${(t.errorRate * 100).toFixed(1)}%` },
                  { label: 'P99 latency', value: `${t.latencyP99} ms` },
                  { label: 'Failure rate', value: `${(t.failureRate * 100).toFixed(1)}%` },
                ]}
              />
            </>
          )}
        </Panel.Body>
      </Panel>
    </div>
  );
}
