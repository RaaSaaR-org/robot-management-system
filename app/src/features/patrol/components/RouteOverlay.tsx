/**
 * @file RouteOverlay.tsx
 * @description Patrol overlay for the robot's map (RobotMapPanel): numbered
 *              checkpoint markers for the robot's active (else last) run, the
 *              route as a walked (solid) / remaining (dashed) path, a ping on
 *              the running leg and severity-tinted pins for its findings, drawn
 *              as SVG over the map canvas in the panel's own world→screen
 *              projection; a glass legend sitting one step ABOVE the canvas's
 *              own bottom-left "1 m" scale bar (see the legend below — do not
 *              move it back down). Renders nothing when the robot has no run —
 *              the map must not carry a permanent pill.
 * @feature patrol
 */

import { memo, useEffect, useMemo } from 'react';
import { cn } from '@/shared/utils/cn';
import type { PatrolFinding, PatrolRun } from '../types/patrol.types';
import { usePatrolStore, selectFindingsForRun, selectOverlayRun } from '../store/patrolStore';
import { runStatusStyle } from '../utils/patrolFormat';
import { OVERLAY_COLOR, PATROL_GLOW_LIVE, PATROL_LIVE_BORDER, PATROL_MOTION, StatusDot, type PatrolTone } from './patrolUi';

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

// ============================================================================
// COMPONENT
// ============================================================================

const LEGEND_TONE: Record<PatrolRun['status'], PatrolTone> = {
  running: 'primary',
  done: 'accent',
  aborted: 'attention',
  failed: 'danger',
  skipped: 'neutral',
};

/** Node fill per leg status — theme-aware CSS vars from the shared vocabulary. */
function nodeFill(status: CheckpointMarker['status']): string {
  if (status === 'done') return OVERLAY_COLOR.done;
  if (status === 'failed' || status === 'skipped') return OVERLAY_COLOR.muted;
  return OVERLAY_COLOR.running;
}

/** Pin fill per finding severity — high = finding red, medium = attention amber, low = neutral. */
function pinFill(severity: FindingPin['severity']): string {
  if (severity === 'high') return OVERLAY_COLOR.finding;
  if (severity === 'medium') return OVERLAY_COLOR.attention;
  return OVERLAY_COLOR.muted;
}

/** Legend leg dot (no text — the legend's text content is contractual). */
const LEG_DOT: Record<CheckpointMarker['status'], string> = {
  pending: 'bg-surface-light-300 dark:bg-surface-500',
  running: 'bg-cobalt-500 animate-pulse',
  done: 'bg-turquoise-600 dark:bg-turquoise-500',
  failed: 'bg-red-500',
  skipped: 'bg-surface-light-400 dark:bg-surface-400',
};

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
  const isRunning = run.status === 'running';
  const findingTotal = run.findingCount || pins.length;

  // Path segments: a leg the robot has reached is drawn solid (done), the rest dashed.
  const projected = checkpoints.map((c) => ({ c, p: project(c.x, c.y) }));
  const doneSegments: string[] = [];
  const remainingSegments: string[] = [];
  for (let i = 1; i < projected.length; i += 1) {
    const a = projected[i - 1];
    const b = projected[i];
    const pts = `${a.p.join(',')} ${b.p.join(',')}`;
    (b.c.status === 'done' ? doneSegments : remainingSegments).push(pts);
  }

  return (
    // The root stays inert so panning/clicking the map below is untouched, but
    // `pointer-events` INHERITS: with only that rule, the browser never
    // hit-tests a marker, so every <title> here was a tooltip that could not
    // fire. The informative groups (and the legend) opt back in individually.
    <div className={cn('absolute inset-0 pointer-events-none', className)} data-testid="patrol-route-overlay" data-run-id={run.runId}>
      {/* Presentational wrapper, not aria-hidden: hiding the whole <svg> also
          hid every marker's name, leaving the operator's only clue to a red
          "high" pin the legend's aggregate count. */}
      <svg width={widthPx} height={heightPx} className="absolute inset-0" role="presentation">
        {doneSegments.map((pts, i) => (
          <polyline key={`done-${i}`} aria-hidden="true" points={pts} fill="none" stroke={OVERLAY_COLOR.done} strokeOpacity={0.8} strokeWidth={2} strokeLinecap="round" />
        ))}
        {remainingSegments.map((pts, i) => (
          <polyline key={`rest-${i}`} aria-hidden="true" points={pts} fill="none" stroke={OVERLAY_COLOR.path} strokeOpacity={0.5} strokeWidth={1.5} strokeDasharray="4 3" strokeLinecap="round" />
        ))}
        {projected.map(({ c, p: [sx, sy] }) => {
          if (!inView(sx, sy)) return null;
          const fill = nodeFill(c.status);
          const running = c.status === 'running';
          return (
            <g
              key={`cp-${c.index}`}
              data-testid="patrol-overlay-checkpoint"
              data-index={c.index}
              data-status={c.status}
              className="group pointer-events-auto focus:outline-none"
              tabIndex={0}
              role="img"
              aria-label={`Checkpoint ${c.index + 1}: ${c.label} — ${c.status}`}
            >
              {/* First child: the hover tooltip. A marker is a dot with a number
                  on it — without this the operator cannot tell WHICH place it is. */}
              <title>{`${c.index + 1}. ${c.label} — ${c.status}`}</title>
              <circle cx={sx} cy={sy} r={9} fill={fill} fillOpacity={0.92} stroke="white" strokeWidth={1.5} />
              {running && (
                <circle
                  cx={sx}
                  cy={sy}
                  r={9}
                  fill="none"
                  stroke={OVERLAY_COLOR.running}
                  strokeWidth={1.5}
                  opacity={0.6}
                  className="animate-ping origin-center [transform-box:fill-box]"
                />
              )}
              <text x={sx} y={sy + 3.5} textAnchor="middle" fontSize={10} fontWeight={700} fill="white" fontFamily="ui-sans-serif, system-ui, sans-serif">
                {c.index + 1}
              </text>
              {/* Drawn ring, not `outline`: an outline on an SVG <g> is not
                  reliably painted, and an invisible focus stop is a trap. */}
              <circle cx={sx} cy={sy} r={13} fill="none" stroke={OVERLAY_COLOR.running} strokeWidth={2} className="opacity-0 group-focus-visible:opacity-100" />
            </g>
          );
        })}
        {pins.map((p) => {
          const [sx, sy] = project(p.x, p.y);
          if (!inView(sx, sy)) return null;
          return (
            <g
              key={`pin-${p.id}`}
              data-testid="patrol-overlay-finding"
              data-severity={p.severity}
              transform={`translate(${sx} ${sy})`}
              className="group pointer-events-auto focus:outline-none"
              tabIndex={0}
              role="img"
              aria-label={`${p.severity} severity finding: ${p.summary}`}
              style={p.severity === 'high' ? { filter: 'drop-shadow(0 0 4px color-mix(in srgb, var(--color-signal-stopped) 50%, transparent))' } : undefined}
            >
              {/* A pin is a coloured teardrop and nothing else: this summary is
                  the only place the map ever says WHAT the robot flagged. */}
              <title>{p.summary}</title>
              <path d="M0 0 C-6 -8 -7 -12 -7 -14 A7 7 0 1 1 7 -14 C7 -12 6 -8 0 0 Z" fill={pinFill(p.severity)} stroke="white" strokeWidth={1.2} />
              <circle cx={0} cy={-14} r={2.5} fill="white" />
              <circle cx={0} cy={-11} r={15} fill="none" stroke={OVERLAY_COLOR.running} strokeWidth={2} className="opacity-0 group-focus-visible:opacity-100" />
            </g>
          );
        })}
      </svg>
      {/* bottom-8, not bottom-2: the map canvas draws its only distance
          reference — the 1 m scale bar and its label — in the bottom-left strip
          (y = height-24 … height-10), and this glass pill is ~90 % opaque, so at
          bottom-2 it erased the scale for every robot that has ever patrolled.
          Up, not sideways: bottom-right holds the "keep-outs not shown" note,
          top-left the place chip, top-right the canvas north arrow.
          `pointer-events-auto` so the title below can reveal the truncated text. */}
      <div
        className={cn(
          'absolute left-2 bottom-8 max-w-[calc(100%-1rem)] pointer-events-auto flex items-center gap-2 glass-elevated rounded-brand px-2.5 py-1.5 text-[11px] font-mono tabular-nums',
          PATROL_MOTION,
          isRunning && cn(PATROL_LIVE_BORDER, PATROL_GLOW_LIVE),
          style.className
        )}
        data-testid="patrol-overlay-legend"
        title={`Patrol ${run.routeName || run.routeId}: ${style.label.toLowerCase()} · ${done}/${run.legs.length}`}
      >
        <StatusDot tone={LEGEND_TONE[run.status] ?? 'neutral'} pulse={isRunning} />
        <span className="truncate min-w-0">
          Patrol {run.routeName || run.routeId}: {style.label.toLowerCase()} · {done}/{run.legs.length}
          {pins.length > 0 || run.findingCount > 0 ? ` · ${findingTotal} finding${findingTotal === 1 ? '' : 's'}` : ''}
        </span>
        {run.legs.length > 0 && run.legs.length <= 12 && (
          <span className="hidden sm:flex items-center gap-1 shrink-0" aria-hidden="true">
            {run.legs.map((l) => (
              <span key={l.index} className={cn('inline-block w-1.5 h-1.5 rounded-full', LEG_DOT[l.status] ?? LEG_DOT.pending)} />
            ))}
          </span>
        )}
      </div>
    </div>
  );
});
