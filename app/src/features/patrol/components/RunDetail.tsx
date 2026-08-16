/**
 * @file RunDetail.tsx
 * @description One patrol run: header (route, mode, origin, status, reason,
 *              times), the leg timeline, baseline-vs-current photo pairs per
 *              checkpoint, and the findings with Acknowledge / This is normal /
 *              Escalate. "Promote to baseline" makes this run the reference.
 * @feature patrol
 */

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/shared/utils/cn';
import { Button } from '@/shared/components/ui/Button';
import { ProgressBar } from '@/shared/components/ui/ProgressBar';
import { SegmentedControl } from '@/shared/components/ui/SegmentedControl';
import type { PatrolFinding, PatrolLeg } from '../types/patrol.types';
import { PATROL_RUN_MODE_LABELS } from '../types/patrol.types';
import { usePatrolStore, selectFindingsForRun, selectRouteById, selectRunById } from '../store/patrolStore';
import { FindingBadge, FindingStatusChip, LegStatusChip, RunStatusChip } from './FindingBadge';
import { PhotoPair } from './PhotoPair';
import { formatWhen, sortFindings } from '../utils/patrolFormat';
import {
  LEG_NODE,
  PATROL_ATTENTION_TEXT,
  PATROL_FADE_IN,
  PATROL_FOCUS,
  PATROL_GLOW_LIVE,
  PATROL_INSET,
  PATROL_MICRO,
  PATROL_MONO,
  PATROL_MOTION,
  PATROL_PANEL,
  PATROL_STICKY_RAIL,
  SEVERITY_RAIL,
  SectionHeader,
} from './patrolUi';

export interface RunDetailProps {
  runId: string;
  /** Robot id → display name. */
  robotNames?: Record<string, string>;
  className?: string;
}

const INSPECTION_TEXT: Record<NonNullable<PatrolLeg['inspection']>, string> = {
  unchanged: 'unchanged (hash gate)',
  changed: 'changed',
  same: 'same as baseline',
  no_baseline: 'no baseline at run time',
  recorded: 'baseline recorded',
  skipped: 'inspection skipped',
  error: 'inspection error',
};

/** Colour of the inspection verdict: turquoise = same as baseline, amber = changed, else muted. */
function inspectionClass(inspection: PatrolLeg['inspection']): string {
  if (inspection === 'same' || inspection === 'unchanged') return 'text-turquoise-700 dark:text-turquoise-400';
  if (inspection === 'changed') return PATROL_ATTENTION_TEXT;
  return 'text-theme-tertiary';
}

/** `mm:ss` / `h:mm:ss` between two ISO times; '—' when the end is unknown. */
function formatDuration(startedAt: string, finishedAt?: string | null): string {
  if (!finishedAt) return '—';
  const ms = Date.parse(finishedAt) - Date.parse(startedAt);
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const PHOTO_MODES = [
  { value: 'side', label: 'Side by side' },
  { value: 'swipe', label: 'Swipe' },
] as const;
type PhotoMode = (typeof PHOTO_MODES)[number]['value'];

// ============================================================================
// FINDING ROW
// ============================================================================

interface FindingRowProps {
  finding: PatrolFinding;
  busy: boolean;
  /** `false` when "This is normal" reached the server but not the robot. */
  robotNotified?: boolean;
  onAck: (id: string) => void;
  onNormal: (id: string) => void;
  onEscalate: (id: string) => void;
}

const FindingRow = memo(function FindingRow({ finding, busy, robotNotified, onAck, onNormal, onEscalate }: FindingRowProps) {
  const ev = finding.evidence ?? {};
  const closed = finding.status === 'dismissed_normal' || finding.status === 'escalated';
  const confidencePct = Math.round(finding.confidence * 100);
  return (
    <li
      id={`finding-${finding.id}`}
      className={cn(
        PATROL_INSET,
        SEVERITY_RAIL[finding.severity],
        PATROL_MOTION,
        PATROL_FADE_IN,
        'flex flex-col gap-2 scroll-mt-24 target:ring-2 target:ring-cobalt-500/40',
      )}
      data-testid="patrol-finding"
      data-finding-id={finding.id}
      data-severity={finding.severity}
      data-status={finding.status}
    >
      <div className="flex flex-wrap items-center gap-2 min-w-0">
        <FindingBadge severity={finding.severity} type={finding.type} />
        <FindingStatusChip status={finding.status} />
        <span className={cn(PATROL_MONO, 'ml-auto')}>{formatWhen(finding.at)}</span>
      </div>
      <p className="text-sm font-medium text-theme-primary break-words">{finding.summary}</p>
      <p className={cn(PATROL_MONO, 'break-words')}>
        {finding.place ? `in ${finding.place}` : 'place unknown'} · leg {finding.legIndex + 1} · {finding.source.replace(/_/g, ' ')}
        {finding.model ? ` · ${finding.model}` : ''} · confidence {confidencePct}%
        {ev.observations ? ` · ${ev.observations} observations` : ''}
      </p>
      <div className="flex items-center gap-2" title={`confidence ${confidencePct}%`}>
        <span className={PATROL_MICRO}>Confidence</span>
        <ProgressBar value={confidencePct} showValue={false} variant="default" className="w-12 [&>div]:h-1" />
      </div>
      {ev.checklistDiff && ev.checklistDiff.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 min-w-0">
          {ev.checklistDiff.map((d) => (
            <li key={d.item} className="glass-subtle rounded-brand px-2 py-0.5 text-xs font-mono text-theme-secondary break-words min-w-0">
              <span className="font-medium text-theme-primary">{d.item}</span>: {d.baseline} → {d.current}
            </li>
          ))}
        </ul>
      )}
      {ev.labels && (ev.labels.added.length > 0 || ev.labels.missing.length > 0) && (
        <p className="flex flex-wrap gap-1.5 text-xs text-theme-secondary break-words min-w-0">
          {ev.labels.added.length > 0 && <span className="glass-subtle rounded-brand px-2 py-0.5 font-mono">new: {ev.labels.added.join(', ')} </span>}
          {ev.labels.missing.length > 0 && <span className="glass-subtle rounded-brand px-2 py-0.5 font-mono">missing: {ev.labels.missing.join(', ')}</span>}
        </p>
      )}
      {ev.blob && (
        <p className="text-xs text-theme-secondary tabular-nums">
          blob {ev.blob.areaM2.toFixed(2)} m² at ({ev.blob.x.toFixed(1)}, {ev.blob.y.toFixed(1)})
        </p>
      )}
      {finding.status === 'dismissed_normal' && robotNotified === false && (
        <p
          className={cn(PATROL_ATTENTION_TEXT, 'text-xs break-words min-w-0 border-l-2 border-l-amber-500/60 pl-2')}
          role="status"
          data-testid="patrol-finding-robot-not-notified"
        >
          Marked normal here — the robot was offline, so its baseline was not updated. It will flag this again until it is taught.
        </p>
      )}
      <div className="flex flex-wrap gap-1.5 sm:justify-end [&>button]:flex-1 sm:[&>button]:flex-none">
        <Button
          size="sm"
          variant="outline"
          data-testid="patrol-finding-ack"
          disabled={busy || finding.status !== 'open'}
          onClick={() => onAck(finding.id)}
        >
          Acknowledge
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="text-turquoise-700 dark:text-turquoise-400 border-turquoise-500/40"
          data-testid="patrol-finding-normal"
          disabled={busy || closed}
          title="Dismiss and teach the baseline that this is normal"
          onClick={() => onNormal(finding.id)}
        >
          This is normal
        </Button>
        <Button
          size="sm"
          variant="destructive"
          data-testid="patrol-finding-escalate"
          disabled={busy || closed}
          title="Open an incident for this finding"
          onClick={() => onEscalate(finding.id)}
        >
          Escalate
        </Button>
      </div>
    </li>
  );
});

// ============================================================================
// COMPONENT
// ============================================================================

export const RunDetail = memo(function RunDetail({ runId, robotNames = {}, className }: RunDetailProps) {
  const run = usePatrolStore(selectRunById(runId));
  const findings = usePatrolStore(selectFindingsForRun(runId));
  const status = usePatrolStore((s) => s.runDetailStatus[runId] ?? 'idle');
  const route = usePatrolStore(selectRouteById(run?.routeId));
  const baseline = usePatrolStore((s) => (run ? s.baselineByRoute[`${run.routeId}|${run.window ?? ''}`] : undefined));
  const busyFindingId = usePatrolStore((s) => s.busyFindingId);
  const findingRobotNotified = usePatrolStore((s) => s.findingRobotNotified);
  const error = usePatrolStore((s) => s.error);

  const fetchRun = usePatrolStore((s) => s.fetchRun);
  const fetchRoute = usePatrolStore((s) => s.fetchRoute);
  const fetchBaseline = usePatrolStore((s) => s.fetchBaseline);
  const promoteRun = usePatrolStore((s) => s.promoteRun);
  const acknowledgeFinding = usePatrolStore((s) => s.acknowledgeFinding);
  const markFindingNormal = usePatrolStore((s) => s.markFindingNormal);
  const escalateFinding = usePatrolStore((s) => s.escalateFinding);

  const [note, setNote] = useState<string | null>(null);
  const [promoting, setPromoting] = useState(false);
  const [photoMode, setPhotoMode] = useState<PhotoMode>('side');

  useEffect(() => {
    void fetchRun(runId);
  }, [runId, fetchRun]);

  useEffect(() => {
    if (run?.routeId && !route) void fetchRoute(run.routeId);
  }, [run?.routeId, route, fetchRoute]);

  useEffect(() => {
    if (run?.routeId && run.mode === 'patrol') void fetchBaseline(run.routeId, run.window);
  }, [run?.routeId, run?.window, run?.mode, fetchBaseline]);

  // Deep link from an alert: scroll the finding into view once it is rendered.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.location.hash.startsWith('#finding-')) return;
    const el = document.getElementById(window.location.hash.slice(1));
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center' });
  }, [findings.length]);

  const sorted = useMemo(() => sortFindings(findings), [findings]);
  const checkpointsById = useMemo(() => {
    const m = new Map<string, { name: string; capture: boolean }>();
    for (const c of route?.checkpoints ?? []) m.set(c.id, { name: c.name, capture: c.actions.includes('capture') });
    return m;
  }, [route]);

  const handlePromote = useCallback(async () => {
    if (!run) return;
    setPromoting(true);
    const ok = await promoteRun(run.runId);
    setPromoting(false);
    setNote(ok ? `Run promoted — it is now the baseline for the ${run.window ?? 'default'} window.` : 'Promote failed.');
    if (ok) void fetchBaseline(run.routeId, run.window);
  }, [run, promoteRun, fetchBaseline]);

  const scrollToPhoto = useCallback((index: number) => {
    const el = document.getElementById(`patrol-photo-${index}`);
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, []);

  if (!run) {
    const loading = status === 'loading' || status === 'idle';
    return (
      <div className={cn('flex flex-col gap-4 lg:grid lg:grid-cols-[300px_minmax(0,1fr)] lg:gap-5 min-w-0', className)} data-testid="patrol-run-detail">
        {loading ? (
          <>
            <div className="flex flex-col gap-4" aria-hidden="true">
              <div className="glass-card rounded-brand-lg animate-pulse h-56" />
              <div className="glass-card rounded-brand-lg animate-pulse h-40" />
            </div>
            <div className="flex flex-col gap-4">
              <div className="glass-card rounded-brand-lg animate-pulse h-48" aria-hidden="true" />
              <div className="glass-card rounded-brand-lg animate-pulse h-64" aria-hidden="true" />
              <p className="sr-only" role="status">
                Loading run…
              </p>
            </div>
          </>
        ) : (
          <div className={cn(PATROL_PANEL, 'lg:col-span-2 text-center card-meta')}>
            This run could not be loaded.
            {error && status === 'error' && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
          </div>
        )}
      </div>
    );
  }

  // After "Promote to baseline" the route's baseline for this window IS this
  // run — comparing its photos against themselves would be a fake "same as
  // baseline" on every checkpoint, so the pair collapses to the captures and
  // says so.
  const baselineIsThisRun = run.mode !== 'baseline' && baseline?.runId === run.runId;
  const canPromote = run.mode !== 'baseline' && run.status === 'done' && !baselineIsThisRun;
  const photoLegs = run.legs.filter((leg) => {
    const cp = checkpointsById.get(leg.checkpointId);
    return Boolean(leg.photoKey) || Boolean(leg.photoDropped) || (cp ? cp.capture : true);
  });

  const photoIndexes = new Set(photoLegs.map((l) => l.index));
  const evidenceFirst = sorted.length > 0;
  const routeName = run.routeName || route?.name || run.routeId;

  const findingsPanel = (
    <section className={cn(PATROL_PANEL, 'flex flex-col gap-3')} data-testid="patrol-findings">
      <SectionHeader as="h3" title="Findings" count={sorted.length} />
      {sorted.length === 0 ? (
        <p className="card-meta text-xs">
          {run.mode === 'baseline' ? 'A baseline run records what is normal; it raises no findings.' : 'Nothing that is not normal was found.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {sorted.map((f) => (
            <FindingRow
              key={f.id}
              finding={f}
              busy={busyFindingId === f.id}
              robotNotified={findingRobotNotified[f.id]}
              onAck={(id) => void acknowledgeFinding(id)}
              onNormal={(id) => void markFindingNormal(id)}
              onEscalate={(id) => void escalateFinding(id)}
            />
          ))}
        </ul>
      )}
    </section>
  );

  const photosPanel =
    photoLegs.length > 0 ? (
      <section className={cn(PATROL_PANEL, 'flex flex-col gap-3')}>
        <SectionHeader
          as="h3"
          title="Control photos"
          count={photoLegs.length}
          actions={
            baselineIsThisRun ? (
              <span className="text-[11px] font-medium text-turquoise-700 dark:text-turquoise-400" data-testid="patrol-run-is-baseline">
                This run is the route's baseline{run.window ? ` for the ${run.window} window` : ''}
              </span>
            ) : run.mode !== 'baseline' ? (
              <SegmentedControl options={[...PHOTO_MODES]} value={photoMode} onChange={setPhotoMode} label="Photo comparison mode" />
            ) : undefined
          }
        />
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {photoLegs.map((leg) => {
            const changed = leg.inspection === 'changed';
            const n = leg.findingIds.length;
            return (
              <div
                key={`photo-${leg.index}`}
                id={`patrol-photo-${leg.index}`}
                className={cn(PATROL_INSET, PATROL_FADE_IN, 'scroll-mt-24 flex flex-col gap-2', changed && 'ring-1 ring-amber-500/40')}
              >
                <div className="flex flex-wrap items-center gap-2 min-w-0">
                  <span className="text-sm font-medium text-theme-primary truncate">
                    <span className={cn(PATROL_MONO, 'text-theme-tertiary')}>{leg.index + 1}</span> · {leg.name || leg.placeId}
                  </span>
                  {leg.inspection && (
                    <span className={cn('ml-auto text-[11px] font-medium whitespace-nowrap', inspectionClass(leg.inspection))}>
                      {INSPECTION_TEXT[leg.inspection]}
                      {changed && n > 0 ? ` · ${n} ${n === 1 ? 'finding' : 'findings'}` : ''}
                    </span>
                  )}
                </div>
                <PhotoPair
                  robotId={run.robotId}
                  checkpointName={leg.name || leg.placeId}
                  currentRunId={run.runId}
                  currentKey={leg.photoKey ?? null}
                  currentDropped={leg.photoDropped ?? null}
                  baselineRunId={run.mode === 'baseline' || baselineIsThisRun ? null : (baseline?.runId ?? null)}
                  baselineRobotId={baseline?.robotId ?? run.robotId}
                  baselineKey={run.mode === 'baseline' || baselineIsThisRun ? null : (baseline?.photos?.[leg.checkpointId] ?? null)}
                  baselineMissingText={baselineIsThisRun ? 'this run is the baseline' : undefined}
                  mode={photoMode}
                />
              </div>
            );
          })}
        </div>
      </section>
    ) : null;

  return (
    <div className={cn('flex flex-col gap-4 lg:grid lg:grid-cols-[300px_minmax(0,1fr)] lg:gap-5 min-w-0', className)} data-testid="patrol-run-detail" data-run-id={run.runId}>
      {/* Left rail: header + leg timeline */}
      <aside className={cn(PATROL_STICKY_RAIL, 'flex flex-col gap-4 min-w-0')}>
        <header className={cn(PATROL_PANEL, 'flex flex-col gap-3', run.status === 'running' && PATROL_GLOW_LIVE)}>
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <RunStatusChip status={run.status} />
            {run.robotId && (
              <Link to={`/agent?robot=${encodeURIComponent(run.robotId)}`} className={cn('ml-auto text-xs text-cobalt-600 dark:text-cobalt-400 hover:underline', PATROL_MOTION)}>
                Agent Mode
              </Link>
            )}
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-lg font-semibold leading-tight text-theme-primary break-words">
              <Link to={`/patrol/routes/${encodeURIComponent(run.routeId)}`} className={cn('hover:text-cobalt-500', PATROL_MOTION)}>
                {routeName}
              </Link>
            </h2>
            <p className="text-xs text-theme-secondary break-words">
              {PATROL_RUN_MODE_LABELS[run.mode]} · {run.origin}
              {run.window ? ` · window ${run.window}` : ''}
            </p>
          </div>
          {run.reason && (
            <p
              className={cn('text-sm break-words', run.status === 'skipped' || run.status === 'failed' ? 'text-amber-600 dark:text-amber-400' : 'text-theme-secondary')}
              data-testid="patrol-run-reason"
            >
              {run.reason}
            </p>
          )}
          <dl className="grid grid-cols-2 lg:grid-cols-[auto_1fr] gap-x-3 gap-y-1 min-w-0">
            <dt className={PATROL_MICRO}>Mode</dt>
            <dd className={cn(PATROL_MONO, 'truncate')}>{PATROL_RUN_MODE_LABELS[run.mode]}</dd>
            <dt className={PATROL_MICRO}>Origin</dt>
            <dd className={cn(PATROL_MONO, 'truncate')}>{run.origin}</dd>
            <dt className={PATROL_MICRO}>Window</dt>
            <dd className={cn(PATROL_MONO, 'truncate')}>{run.window ?? '—'}</dd>
            <dt className={PATROL_MICRO}>Robot</dt>
            <dd className={cn(PATROL_MONO, 'truncate')}>{robotNames[run.robotId] ?? run.robotId}</dd>
            <dt className={PATROL_MICRO}>Started</dt>
            <dd className={cn(PATROL_MONO, 'truncate')}>{formatWhen(run.startedAt)}</dd>
            <dt className={PATROL_MICRO}>Finished</dt>
            <dd className={cn(PATROL_MONO, 'truncate', run.status === 'running' && 'text-cobalt-700 dark:text-cobalt-300')}>
              {run.finishedAt ? formatWhen(run.finishedAt) : run.status === 'running' ? 'running' : '—'}
            </dd>
            <dt className={PATROL_MICRO}>Duration</dt>
            <dd className={cn(PATROL_MONO, 'truncate')}>{formatDuration(run.startedAt, run.finishedAt)}</dd>
            <dt className={PATROL_MICRO}>Findings</dt>
            <dd className={cn(PATROL_MONO, 'truncate', run.findingCount > 0 && cn(PATROL_ATTENTION_TEXT, 'font-semibold'))}>
              {run.findingCount} {run.findingCount === 1 ? 'finding' : 'findings'}
            </dd>
          </dl>
          <div className="flex flex-col gap-2 pt-1 border-t border-glass-subtle">
            {note && (
              <span className="text-xs text-theme-secondary break-words" role="status">
                {note}
              </span>
            )}
            <Button
              size="sm"
              variant="outline"
              fullWidth
              data-testid="patrol-run-promote"
              disabled={!canPromote || promoting}
              isLoading={promoting}
              title={
                baselineIsThisRun
                  ? 'This run already is the baseline for its window'
                  : canPromote
                    ? "This run's captures become the baseline for its window"
                    : 'Only a finished patrol run can be promoted'
              }
              onClick={() => void handlePromote()}
            >
              {baselineIsThisRun ? 'Current baseline' : 'Promote to baseline'}
            </Button>
          </div>
        </header>

        {/* Legs */}
        <section className={cn(PATROL_PANEL, 'flex flex-col gap-3')}>
          <SectionHeader as="h3" title="Legs" count={run.legs.length} />
          {run.legs.length === 0 ? (
            <p className="card-meta text-xs">No legs — the run was refused before the robot moved.</p>
          ) : (
            <ol className="relative flex flex-col gap-2.5 before:absolute before:left-[11px] before:top-3 before:bottom-3 before:w-px before:bg-[var(--glass-border-highlight)]">
              {run.legs.map((leg) => {
                const hasPhoto = photoIndexes.has(leg.index);
                const n = leg.findingIds.length;
                const time = leg.finishedAt ? formatWhen(leg.finishedAt) : leg.startedAt ? formatWhen(leg.startedAt) : '';
                const body = (
                  <>
                    <span
                      className={cn(
                        'relative z-[1] shrink-0 w-6 h-6 rounded-full inline-flex items-center justify-center text-[11px] font-semibold tabular-nums',
                        PATROL_MOTION,
                        LEG_NODE[leg.status],
                      )}
                      aria-hidden="true"
                    >
                      {leg.index + 1}
                    </span>
                    <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
                        <span className="text-sm font-medium text-theme-primary truncate">{leg.name || leg.placeId}</span>
                        <LegStatusChip status={leg.status} />
                        {time && <span className={cn(PATROL_MONO, 'ml-auto text-[11px]')}>{time}</span>}
                      </span>
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] min-w-0">
                        {leg.inspection && <span className={cn('font-medium', inspectionClass(leg.inspection))}>{INSPECTION_TEXT[leg.inspection]}</span>}
                        {leg.photoDropped === 'person' && <span className="text-theme-tertiary">photo not stored (person)</span>}
                        {n > 0 && (
                          <span className={cn(PATROL_ATTENTION_TEXT, 'font-medium')}>
                            {n} {n === 1 ? 'finding' : 'findings'}
                          </span>
                        )}
                      </span>
                      {leg.message && <span className="card-meta text-xs break-words">{leg.message}</span>}
                    </span>
                  </>
                );
                return (
                  <li key={`${leg.index}-${leg.checkpointId}`} className="min-w-0" data-testid="patrol-leg" data-index={leg.index} data-status={leg.status}>
                    {hasPhoto ? (
                      <button
                        type="button"
                        onClick={() => scrollToPhoto(leg.index)}
                        title={`Show the control photo of ${leg.name || leg.placeId}`}
                        className={cn('w-full text-left flex items-start gap-2 rounded-brand -mx-1 px-1 py-0.5 hover:bg-theme-hover', PATROL_MOTION, PATROL_FOCUS)}
                      >
                        {body}
                      </button>
                    ) : (
                      <div className="flex items-start gap-2 py-0.5">{body}</div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </aside>

      {/* Right column: evidence first — findings lead when there are any, then the proof. */}
      <div className="flex flex-col gap-4 min-w-0">
        {evidenceFirst ? (
          <>
            {findingsPanel}
            {photosPanel}
          </>
        ) : (
          <>
            {photosPanel}
            {findingsPanel}
          </>
        )}
      </div>
    </div>
  );
});
