/**
 * @file RouteOverlay.tsx
 * @description Patrol overlay for the robot's map (RobotMapPanel): numbered
 *              checkpoint markers for the robot's active (else last) run and
 *              red pins for its findings, drawn as SVG over the map canvas in
 *              the panel's own world→screen projection. Renders nothing when
 *              the robot has no run — the map must not carry a permanent pill.
 * @feature patrol
 */

import { memo, useEffect, useMemo } from 'react';
import { cn } from '@/shared/utils/cn';
import type { PatrolFinding, PatrolRun } from '../types/patrol.types';
import { usePatrolStore, selectFindingsForRun, selectOverlayRun } from '../store/patrolStore';
import { runStatusStyle } from '../utils/patrolFormat';

// ============================================================================
// PURE
// ============================================================================

export type Projector = (x: number, y: number) => [number, number];

export interface CheckpointMarker {
  kind: 'checkpoint';
  index: number;
  label: string;
  x: number;
  y: number;
  status: PatrolRun['legs'][number]['status'];
}

export interface FindingPin {
  kind: 'finding';
  id: string;
  x: number;
  y: number;
  severity: PatrolFinding['severity'];
  summary: string;
}

/**
 * The markers a run yields: one per leg WITH a pose (legs without a pose are
 * listed in the legend only — inventing a position would be a claim), one pin
 * per finding with a pose.
 */
export function overlayMarkers(run: PatrolRun | null, findings: readonly PatrolFinding[]): {
  checkpoints: CheckpointMarker[];
  pins: FindingPin[];
} {
  if (!run) return { checkpoints: [], pins: [] };
  const checkpoints: CheckpointMarker[] = [];
  for (const leg of run.legs) {
    if (!leg.pose) continue;
    checkpoints.push({ kind: 'checkpoint', index: leg.index, label: leg.name || leg.placeId, x: leg.pose.x, y: leg.pose.y, status: leg.status });
  }
  const pins: FindingPin[] = [];
  for (const f of findings) {
    if (f.runId !== run.runId || !f.pose) continue;
    pins.push({ kind: 'finding', id: f.id, x: f.pose.x, y: f.pose.y, severity: f.severity, summary: f.summary });
  }
  return { checkpoints, pins };
}

const COLOR_CHECKPOINT = '#2A5FFF';
const COLOR_DONE = '#18E4C3';
const COLOR_FINDING = '#ef4444';

// ============================================================================
// COMPONENT
// ============================================================================

export interface RouteOverlayProps {
  robotId: string | null;
  /** World (odom, metres) → screen (px) — the map panel's projection. */
  project: Projector;
  widthPx: number;
  heightPx: number;
  className?: string;
}

export const RouteOverlay = memo(function RouteOverlay({ robotId, project, widthPx, heightPx, className }: RouteOverlayProps) {
  const run = usePatrolStore(selectOverlayRun(robotId));
  const findings = usePatrolStore(selectFindingsForRun(run?.runId));
  const fetchLatestRun = usePatrolStore((s) => s.fetchLatestRun);

  // Seed from the server once per robot; live events keep it current.
  useEffect(() => {
    if (robotId) void fetchLatestRun(robotId);
  }, [robotId, fetchLatestRun]);

  const { checkpoints, pins } = useMemo(() => overlayMarkers(run, findings), [run, findings]);

  if (!run || widthPx === 0 || heightPx === 0) return null;

  const inView = (sx: number, sy: number) => sx >= -20 && sy >= -20 && sx <= widthPx + 20 && sy <= heightPx + 20;
  const done = run.legs.filter((l) => l.status === 'done').length;
  const style = runStatusStyle(run.status);

  return (
    <div className={cn('absolute inset-0 pointer-events-none', className)} data-testid="patrol-route-overlay" data-run-id={run.runId}>
      <svg width={widthPx} height={heightPx} className="absolute inset-0" aria-hidden="true">
        {checkpoints.length >= 2 && (
          <polyline
            points={checkpoints.map((c) => project(c.x, c.y).join(',')).join(' ')}
            fill="none"
            stroke={COLOR_CHECKPOINT}
            strokeOpacity={0.5}
            strokeWidth={1.5}
            strokeDasharray="4 3"
          />
        )}
        {checkpoints.map((c) => {
          const [sx, sy] = project(c.x, c.y);
          if (!inView(sx, sy)) return null;
          const fill = c.status === 'done' ? COLOR_DONE : c.status === 'failed' || c.status === 'skipped' ? '#9ca3af' : COLOR_CHECKPOINT;
          return (
            <g key={`cp-${c.index}`} data-testid="patrol-overlay-checkpoint" data-index={c.index}>
              <circle cx={sx} cy={sy} r={9} fill={fill} fillOpacity={0.9} stroke="white" strokeWidth={1.5} />
              <text x={sx} y={sy + 3.5} textAnchor="middle" fontSize={10} fontWeight={700} fill="white" fontFamily="ui-sans-serif, system-ui, sans-serif">
                {c.index + 1}
              </text>
              <title>{`${c.index + 1}. ${c.label} — ${c.status}`}</title>
            </g>
          );
        })}
        {pins.map((p) => {
          const [sx, sy] = project(p.x, p.y);
          if (!inView(sx, sy)) return null;
          return (
            <g key={`pin-${p.id}`} data-testid="patrol-overlay-finding" data-severity={p.severity} transform={`translate(${sx} ${sy})`}>
              <path d="M0 0 C-6 -8 -7 -12 -7 -14 A7 7 0 1 1 7 -14 C7 -12 6 -8 0 0 Z" fill={COLOR_FINDING} stroke="white" strokeWidth={1.2} />
              <circle cx={0} cy={-14} r={2.5} fill="white" />
              <title>{p.summary}</title>
            </g>
          );
        })}
      </svg>
      <div
        className={cn(
          'absolute left-2 bottom-2 max-w-[calc(100%-1rem)] truncate rounded-brand px-2 py-0.5 text-[11px] font-medium tabular-nums glass-elevated',
          style.className
        )}
        data-testid="patrol-overlay-legend"
        title={`Patrol ${run.routeName || run.routeId}: ${style.label.toLowerCase()} · ${done}/${run.legs.length}`}
      >
        Patrol {run.routeName || run.routeId}: {style.label.toLowerCase()} · {done}/{run.legs.length}
        {pins.length > 0 || run.findingCount > 0 ? ` · ${run.findingCount || pins.length} finding${(run.findingCount || pins.length) === 1 ? '' : 's'}` : ''}
      </div>
    </div>
  );
});
