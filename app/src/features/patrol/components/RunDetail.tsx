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
import type { PatrolFinding, PatrolLeg } from '../types/patrol.types';
import { PATROL_RUN_MODE_LABELS } from '../types/patrol.types';
import { usePatrolStore, selectFindingsForRun, selectRouteById, selectRunById } from '../store/patrolStore';
import { FindingBadge, FindingStatusChip, LegStatusChip, RunStatusChip } from './FindingBadge';
import { PhotoPair } from './PhotoPair';
import { formatWhen, sortFindings } from '../utils/patrolFormat';

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
  no_baseline: 'no baseline yet',
  recorded: 'baseline recorded',
  skipped: 'inspection skipped',
  error: 'inspection error',
};

// ============================================================================
// FINDING ROW
// ============================================================================

interface FindingRowProps {
  finding: PatrolFinding;
  busy: boolean;
  onAck: (id: string) => void;
  onNormal: (id: string) => void;
  onEscalate: (id: string) => void;
}

const FindingRow = memo(function FindingRow({ finding, busy, onAck, onNormal, onEscalate }: FindingRowProps) {
  const ev = finding.evidence ?? {};
  const closed = finding.status === 'dismissed_normal' || finding.status === 'escalated';
  return (
    <li
      id={`finding-${finding.id}`}
      className="glass-subtle rounded-brand p-3 flex flex-col gap-2 min-w-0 scroll-mt-24 target:ring-2 target:ring-cobalt-500/40"
      data-testid="patrol-finding"
      data-finding-id={finding.id}
      data-severity={finding.severity}
      data-status={finding.status}
    >
      <div className="flex flex-wrap items-center gap-2 min-w-0">
        <FindingBadge severity={finding.severity} type={finding.type} />
        <FindingStatusChip status={finding.status} />
        <span className="card-meta text-[11px] tabular-nums ml-auto">{formatWhen(finding.at)}</span>
      </div>
      <p className="text-sm text-theme-primary break-words">{finding.summary}</p>
      <p className="card-meta text-xs break-words">
        {finding.place ? `in ${finding.place}` : 'place unknown'} · leg {finding.legIndex + 1} · {finding.source.replace(/_/g, ' ')}
        {finding.model ? ` · ${finding.model}` : ''} · confidence {(finding.confidence * 100).toFixed(0)}%
        {ev.observations ? ` · ${ev.observations} observations` : ''}
      </p>
      {ev.checklistDiff && ev.checklistDiff.length > 0 && (
        <ul className="text-xs text-theme-secondary list-disc pl-4">
          {ev.checklistDiff.map((d) => (
            <li key={d.item}>
              <span className="font-medium">{d.item}</span>: {d.baseline} → {d.current}
            </li>
          ))}
        </ul>
      )}
      {ev.labels && (ev.labels.added.length > 0 || ev.labels.missing.length > 0) && (
        <p className="text-xs text-theme-secondary break-words">
          {ev.labels.added.length > 0 && <>new: {ev.labels.added.join(', ')} </>}
          {ev.labels.missing.length > 0 && <>missing: {ev.labels.missing.join(', ')}</>}
        </p>
      )}
      {ev.blob && (
        <p className="text-xs text-theme-secondary tabular-nums">
          blob {ev.blob.areaM2.toFixed(2)} m² at ({ev.blob.x.toFixed(1)}, {ev.blob.y.toFixed(1)})
        </p>
      )}
      <div className="flex flex-wrap gap-1.5 justify-end">
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

  if (!run) {
    return (
      <div className={cn('glass-card p-6 text-center card-meta', className)} data-testid="patrol-run-detail">
        {status === 'loading' || status === 'idle' ? 'Loading run…' : 'This run could not be loaded.'}
        {error && status === 'error' && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>
    );
  }

  const canPromote = run.mode !== 'baseline' && run.status === 'done';
  const photoLegs = run.legs.filter((leg) => {
    const cp = checkpointsById.get(leg.checkpointId);
    return Boolean(leg.photoKey) || Boolean(leg.photoDropped) || (cp ? cp.capture : true);
  });

  return (
    <div className={cn('flex flex-col gap-4 min-w-0', className)} data-testid="patrol-run-detail" data-run-id={run.runId}>
      {/* Header */}
      <header className="glass-card p-4 flex flex-col gap-2 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <RunStatusChip status={run.status} />
          <span className="text-xs text-theme-secondary">
            {PATROL_RUN_MODE_LABELS[run.mode]} · {run.origin}
            {run.window ? ` · window ${run.window}` : ''}
          </span>
          <span className="ml-auto flex gap-1.5">
            {run.robotId && (
              <Link to={`/agent?robot=${encodeURIComponent(run.robotId)}`} className="text-xs text-cobalt-500 hover:underline">
                Agent Mode
              </Link>
            )}
          </span>
        </div>
        <h2 className="card-title text-base break-words">
          <Link to={`/patrol/routes/${encodeURIComponent(run.routeId)}`} className="hover:text-cobalt-500">
            {run.routeName || route?.name || run.routeId}
          </Link>
        </h2>
        <p className="card-meta text-xs break-words">
          {robotNames[run.robotId] ?? run.robotId} · started {formatWhen(run.startedAt)}
          {run.finishedAt ? ` · finished ${formatWhen(run.finishedAt)}` : ' · running'}
          {' · '}
          {run.findingCount} {run.findingCount === 1 ? 'finding' : 'findings'}
        </p>
        {run.reason && (
          <p className={cn('text-sm', run.status === 'skipped' || run.status === 'failed' ? 'text-amber-600 dark:text-amber-400' : 'text-theme-secondary')} data-testid="patrol-run-reason">
            {run.reason}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 justify-end">
          {note && (
            <span className="text-xs text-theme-secondary mr-auto" role="status">
              {note}
            </span>
          )}
          <Button
            size="sm"
            variant="outline"
            data-testid="patrol-run-promote"
            disabled={!canPromote || promoting}
            isLoading={promoting}
            title={canPromote ? "This run's captures become the baseline for its window" : 'Only a finished patrol run can be promoted'}
            onClick={() => void handlePromote()}
          >
            Promote to baseline
          </Button>
        </div>
      </header>

      {/* Legs */}
      <section className="glass-card p-4 min-w-0">
        <h3 className="card-title text-sm mb-2">Legs</h3>
        {run.legs.length === 0 ? (
          <p className="card-meta text-xs">No legs — the run was refused before the robot moved.</p>
        ) : (
          <ol className="flex flex-col gap-1.5">
            {run.legs.map((leg) => (
              <li
                key={`${leg.index}-${leg.checkpointId}`}
                className="flex items-start gap-2 min-w-0 text-sm"
                data-testid="patrol-leg"
                data-index={leg.index}
                data-status={leg.status}
              >
                <span className="shrink-0 w-6 h-6 rounded-full bg-cobalt-500/15 text-cobalt-600 dark:text-cobalt-300 text-xs font-semibold inline-flex items-center justify-center tabular-nums">
                  {leg.index + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-theme-primary truncate">{leg.name || leg.placeId}</span>
                    <LegStatusChip status={leg.status} />
                    {leg.inspection && <span className="card-meta text-[11px]">{INSPECTION_TEXT[leg.inspection]}</span>}
                    {leg.photoDropped === 'person' && <span className="card-meta text-[11px]">photo not stored (person)</span>}
                    {leg.findingIds.length > 0 && (
                      <span className="text-[11px] text-amber-600 dark:text-amber-400">
                        {leg.findingIds.length} {leg.findingIds.length === 1 ? 'finding' : 'findings'}
                      </span>
                    )}
                  </div>
                  {leg.message && <p className="card-meta text-xs break-words">{leg.message}</p>}
                </div>
                <span className="card-meta text-[11px] tabular-nums shrink-0">{leg.finishedAt ? formatWhen(leg.finishedAt) : leg.startedAt ? formatWhen(leg.startedAt) : ''}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* Photos */}
      {photoLegs.length > 0 && (
        <section className="glass-card p-4 min-w-0">
          <h3 className="card-title text-sm mb-2">Control photos</h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {photoLegs.map((leg) => (
              <div key={`photo-${leg.index}`} className="min-w-0">
                <p className="text-xs text-theme-secondary mb-1 truncate">
                  {leg.index + 1}. {leg.name || leg.placeId}
                </p>
                <PhotoPair
                  robotId={run.robotId}
                  checkpointName={leg.name || leg.placeId}
                  currentRunId={run.runId}
                  currentKey={leg.photoKey ?? null}
                  currentDropped={leg.photoDropped ?? null}
                  baselineRunId={run.mode === 'baseline' ? null : (baseline?.runId ?? null)}
                  baselineRobotId={baseline?.robotId ?? run.robotId}
                  baselineKey={run.mode === 'baseline' ? null : (baseline?.photos?.[leg.checkpointId] ?? null)}
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Findings */}
      <section className="glass-card p-4 min-w-0" data-testid="patrol-findings">
        <h3 className="card-title text-sm mb-2">Findings ({sorted.length})</h3>
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
                onAck={(id) => void acknowledgeFinding(id)}
                onNormal={(id) => void markFindingNormal(id)}
                onEscalate={(id) => void escalateFinding(id)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
});
