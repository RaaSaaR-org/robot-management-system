/**
 * @file RunDetail.tsx
 * @description One patrol run as a detail page: header (route, date, robot,
 *              status; Promote to baseline, Abort run), the findings to triage
 *              (Acknowledge / This is normal / Escalate), the checkpoints with
 *              their baseline-vs-current photo pairs, and a Details panel.
 * @feature patrol
 */

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Check, CircleSlash, Flag, ShieldCheck, Square } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import {
  Button,
  EmptyState,
  ErrorState,
  KeyValueList,
  PageHeader,
  Panel,
  ProgressBar,
  RowActions,
  SegmentedControl,
  SkeletonText,
  confirm,
  toast,
} from '@/shared/components/ui';
import type { PatrolFinding, PatrolLeg } from '../types/patrol.types';
import { PATROL_RUN_MODE_LABELS } from '../types/patrol.types';
import { usePatrolStore, selectFindingsForRun, selectRouteById, selectRunById } from '../store/patrolStore';
import { FindingBadge, FindingStatusChip, LegStatusChip, RunStatusChip } from './FindingBadge';
import { PhotoPair } from './PhotoPair';
import { describeRunReason } from './opsUi';
import { formatWhen, sortFindings } from '../utils/patrolFormat';

export interface RunDetailProps {
  runId: string;
  /** Robot id → display name. */
  robotNames?: Record<string, string>;
  className?: string;
}

const ICON = 'h-4 w-4';
const INSET_ROW = 'rounded-control border border-line-subtle bg-inset p-4';
/** A line that needs the operator's attention — warning signal, never red. */
const ATTENTION = 'text-signal-unknown';
const NOTE = 'text-xs break-words min-w-0 border-l-2 border-signal-unknown/40 pl-2';

const INSPECTION_TEXT: Record<NonNullable<PatrolLeg['inspection']>, string> = {
  unchanged: 'unchanged (hash gate)',
  changed: 'changed',
  same: 'same as baseline',
  no_baseline: 'no baseline at run time',
  recorded: 'baseline recorded',
  skipped: 'inspection skipped',
  error: 'inspection error',
};

/**
 * A checkpoint the robot REACHED but could not inspect: no control photo, or no
 * checklist answer (camera/sidecar down, checklist model down or unparseable).
 * Only a failed `goto` fails a leg, so such a leg ends 'done' — the same rule
 * `blindLegs()` in robot-agent/src/agent-mode/patrol.ts applies when it writes
 * the run's reason. Without saying so, a blind leg reads as a clean one and the
 * operator takes "nothing found here" for "nothing is wrong here".
 */
function isBlindLeg(leg: PatrolLeg): boolean {
  return leg.status === 'done' && (leg.photoDropped === 'error' || leg.inspection === 'error');
}

/** What the robot came back without at a blind checkpoint. */
function blindReasonText(leg: PatrolLeg): string {
  const missing: string[] = [];
  if (leg.photoDropped === 'error') missing.push('no control photo');
  if (leg.inspection === 'error') missing.push('no checklist answer');
  return missing.join(' and ') || 'nothing was captured';
}

/** Colour of the inspection verdict: measured = same as baseline, estimated = changed, else muted. */
function inspectionClass(inspection: PatrolLeg['inspection']): string {
  if (inspection === 'same' || inspection === 'unchanged') return 'text-signal-measured';
  if (inspection === 'changed') return ATTENTION;
  return 'text-ink-tertiary';
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

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
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
  onAck: (f: PatrolFinding) => void;
  onNormal: (f: PatrolFinding) => void;
  onEscalate: (f: PatrolFinding) => void;
}

const FindingRow = memo(function FindingRow({ finding, busy, robotNotified, onAck, onNormal, onEscalate }: FindingRowProps) {
  const ev = finding.evidence ?? {};
  // A verdict is a judgement, not a one-way door. Only the verdict a finding
  // already carries is disabled: an operator who clicked "This is normal" on a
  // person in the hallway must still be able to escalate it, and the server
  // accepts either transition from any status. Acknowledge stays open-only —
  // it says "seen", which a decided finding already is.
  const isNormal = finding.status === 'dismissed_normal';
  const isEscalated = finding.status === 'escalated';
  const confidencePct = Math.round(finding.confidence * 100);
  const meta = [
    finding.place ? `in ${finding.place}` : 'place unknown',
    `checkpoint ${finding.legIndex + 1}`,
    finding.source.replace(/_/g, ' '),
    finding.model ?? null,
    ev.observations ? plural(ev.observations, 'observation', 'observations') : null,
  ].filter(Boolean);
  return (
    <li
      id={`finding-${finding.id}`}
      className={cn(INSET_ROW, 'flex flex-col gap-2 scroll-mt-24 target:outline-2 target:outline-primary')}
      data-testid="patrol-finding"
      data-finding-id={finding.id}
      data-severity={finding.severity}
      data-status={finding.status}
    >
      <div className="flex flex-wrap items-center gap-2 min-w-0">
        <FindingBadge severity={finding.severity} type={finding.type} />
        <FindingStatusChip status={finding.status} />
        <span className="ml-auto text-xs text-ink-tertiary tabular-nums">{formatWhen(finding.at)}</span>
      </div>
      <p className="text-sm font-medium text-ink-primary break-words">{finding.summary}</p>
      <p className="text-[13px] text-ink-tertiary break-words">{meta.join(' · ')}</p>
      <div className="flex items-center gap-2" title={`Confidence ${confidencePct}%`}>
        <span className="text-xs text-ink-tertiary">Confidence</span>
        <ProgressBar value={confidencePct} showValue={false} size="sm" className="w-16" />
        <span className="text-xs text-ink-secondary tabular-nums">{confidencePct}%</span>
      </div>
      {ev.checklistDiff && ev.checklistDiff.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 min-w-0">
          {ev.checklistDiff.map((d) => (
            <li key={d.item} className="rounded-tag border border-line-subtle bg-panel px-2 py-0.5 text-xs text-ink-secondary break-words min-w-0">
              <span className="font-medium text-ink-primary">{d.item}</span>: {d.baseline} → {d.current}
            </li>
          ))}
        </ul>
      )}
      {ev.labels && (ev.labels.added.length > 0 || ev.labels.missing.length > 0) && (
        <p className="flex flex-wrap gap-1.5 text-xs text-ink-secondary break-words min-w-0">
          {ev.labels.added.length > 0 && <span className="rounded-tag border border-line-subtle bg-panel px-2 py-0.5">new: {ev.labels.added.join(', ')}</span>}
          {ev.labels.missing.length > 0 && <span className="rounded-tag border border-line-subtle bg-panel px-2 py-0.5">missing: {ev.labels.missing.join(', ')}</span>}
        </p>
      )}
      {ev.blob && (
        <p className="text-xs text-ink-secondary tabular-nums">
          Blob {ev.blob.areaM2.toFixed(2)} m² at ({ev.blob.x.toFixed(1)}, {ev.blob.y.toFixed(1)})
        </p>
      )}
      {isNormal && robotNotified === false && (
        <p className={cn(NOTE, ATTENTION)} role="status" data-testid="patrol-finding-robot-not-notified">
          Marked normal here — the robot was offline, so its baseline was not updated. It will flag this again until it is taught.
        </p>
      )}
      <div className="flex items-center justify-end gap-1.5">
        <Button
          size="sm"
          variant="secondary"
          leftIcon={<Check className={ICON} strokeWidth={1.75} />}
          data-testid="patrol-finding-ack"
          disabled={busy || finding.status !== 'open'}
          isLoading={busy}
          onClick={() => onAck(finding)}
        >
          Acknowledge
        </Button>
        <RowActions
          label={`More actions for ${finding.summary}`}
          items={[
            {
              label: 'This is normal',
              icon: <ShieldCheck />,
              disabled: busy || isNormal,
              onSelect: () => onNormal(finding),
            },
            {
              label: 'Escalate',
              icon: <Flag />,
              disabled: busy || isEscalated,
              onSelect: () => onEscalate(finding),
            },
          ]}
        />
      </div>
    </li>
  );
});

// ============================================================================
// COMPONENT
// ============================================================================

function errorText(fallback: string): { description: string } {
  return { description: usePatrolStore.getState().error ?? fallback };
}

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
  const abortRun = usePatrolStore((s) => s.abortRun);
  const acknowledgeFinding = usePatrolStore((s) => s.acknowledgeFinding);
  const markFindingNormal = usePatrolStore((s) => s.markFindingNormal);
  const escalateFinding = usePatrolStore((s) => s.escalateFinding);

  const [promoting, setPromoting] = useState(false);
  const [aborting, setAborting] = useState(false);
  const [photoMode, setPhotoMode] = useState<PhotoMode>('side');

  useEffect(() => {
    if (runId) void fetchRun(runId);
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

  const routeName = run ? run.routeName || route?.name || run.routeId : '';

  const handlePromote = useCallback(async () => {
    if (!run) return;
    const ok = await confirm({
      title: 'Make this run the baseline?',
      description: `Future runs of ${routeName} in the ${run.window ?? 'default'} window compare their photos to this run.`,
      confirmLabel: 'Promote to baseline',
    });
    if (!ok) return;
    setPromoting(true);
    const done = await promoteRun(run.runId);
    setPromoting(false);
    if (done) {
      toast.success('Baseline updated', { description: `This run is now the baseline for the ${run.window ?? 'default'} window.` });
      void fetchBaseline(run.routeId, run.window);
    } else {
      toast.error("Couldn't promote the run", errorText('The server refused the request.'));
    }
  }, [run, routeName, promoteRun, fetchBaseline]);

  const handleAbort = useCallback(async () => {
    if (!run) return;
    const ok = await confirm({
      title: `Abort the run on ${routeName}?`,
      description: 'The robot stops walking the route and returns control. Checkpoints not reached stay uninspected.',
      confirmLabel: 'Abort run',
      tone: 'danger',
    });
    if (!ok) return;
    setAborting(true);
    const done = await abortRun(run.routeId, run.robotId);
    setAborting(false);
    if (done) {
      toast.success('Run aborted');
      void fetchRun(run.runId);
    } else {
      toast.error("Couldn't abort the run", errorText('The robot did not confirm the abort.'));
    }
  }, [run, routeName, abortRun, fetchRun]);

  const handleAck = useCallback(async (f: PatrolFinding) => {
    if (await acknowledgeFinding(f.id)) toast.success('Finding acknowledged', { description: f.summary });
    else toast.error("Couldn't acknowledge the finding", errorText('The server refused the request.'));
  }, [acknowledgeFinding]);

  const handleNormal = useCallback(async (f: PatrolFinding) => {
    if (await markFindingNormal(f.id)) toast.success('Marked as normal', { description: f.summary });
    else toast.error("Couldn't mark the finding as normal", errorText('The server refused the request.'));
  }, [markFindingNormal]);

  const handleEscalate = useCallback(async (f: PatrolFinding) => {
    const ok = await confirm({
      title: 'Escalate this finding?',
      description: 'An alert is raised for the on-call operator.',
      confirmLabel: 'Escalate',
    });
    if (!ok) return;
    if (await escalateFinding(f.id)) toast.success('Finding escalated', { description: f.summary });
    else toast.error("Couldn't escalate the finding", errorText('The server refused the request.'));
  }, [escalateFinding]);

  const back = { to: '/patrol', label: 'Patrol' };

  if (!run) {
    const loading = runId !== '' && (status === 'loading' || status === 'idle');
    return (
      <div className={cn('flex flex-col gap-6 min-w-0', className)} data-testid="patrol-run-detail">
        <PageHeader eyebrow="Automate" back={back} title={loading ? 'Loading…' : 'Patrol run'} />
        <Panel>
          {loading ? (
            <>
              <SkeletonText lines={4} />
              <p className="sr-only" role="status">Loading run…</p>
            </>
          ) : (
            <ErrorState
              title="Couldn't load this run"
              message={(status === 'error' && error) || 'The run does not exist or is no longer on the robot.'}
              onRetry={runId ? () => void fetchRun(runId) : undefined}
            />
          )}
        </Panel>
      </div>
    );
  }

  // After "Promote to baseline" the route's baseline for this window IS this
  // run — comparing its photos against themselves would be a fake "same as
  // baseline" on every checkpoint, so the pair collapses to the captures and
  // says so.
  const baselineIsThisRun = run.mode !== 'baseline' && baseline?.runId === run.runId;
  const canPromote = run.mode !== 'baseline' && run.status === 'done' && !baselineIsThisRun;
  const photoIndexes = new Set(
    run.legs
      .filter((leg) => {
        const cp = checkpointsById.get(leg.checkpointId);
        return Boolean(leg.photoKey) || Boolean(leg.photoDropped) || (cp ? cp.capture : true);
      })
      .map((l) => l.index),
  );
  const blindLegCount = run.legs.filter(isBlindLeg).length;
  // A `done` run carries a reason only when something went wrong anyway
  // ("N checkpoint(s) not inspected") — muting it there hid the one line that
  // says the patrol was partly blind.
  const reasonNeedsAttention = run.status !== 'done' || blindLegCount > 0;
  const robotName = robotNames[run.robotId] ?? run.robotId;
  const kind = run.mode === 'baseline' ? 'Baseline run' : 'Patrol run';

  const details = [
    { label: 'Route', value: <Link to={`/patrol/routes/${encodeURIComponent(run.routeId)}`} className="text-primary hover:underline">{routeName}</Link> },
    {
      label: 'Robot',
      value: run.robotId ? (
        <Link to={`/agent?robot=${encodeURIComponent(run.robotId)}`} className="text-primary hover:underline" title="Open in Agent Mode">{robotName}</Link>
      ) : null,
    },
    { label: 'Mode', value: PATROL_RUN_MODE_LABELS[run.mode] },
    { label: 'Origin', value: run.origin },
    { label: 'Window', value: run.window },
    { label: 'Started', value: <span className="tabular-nums">{formatWhen(run.startedAt)}</span> },
    { label: 'Finished', value: <span className="tabular-nums">{run.finishedAt ? formatWhen(run.finishedAt) : run.status === 'running' ? 'Still running' : null}</span> },
    { label: 'Duration', value: <span className="tabular-nums">{formatDuration(run.startedAt, run.finishedAt)}</span> },
    { label: 'Findings', value: <span className="tabular-nums">{plural(run.findingCount, 'finding', 'findings')}</span> },
    { label: 'Run ID', value: run.runId, mono: true },
  ];

  return (
    <div className={cn('flex flex-col gap-6 min-w-0', className)} data-testid="patrol-run-detail" data-run-id={run.runId}>
      <PageHeader
        eyebrow="Automate"
        back={back}
        title={routeName}
        description={`${kind} · ${formatWhen(run.startedAt)} · ${robotName}`}
        meta={<RunStatusChip status={run.status} />}
        actions={
          <>
            {run.status === 'running' && (
              <Button variant="secondary" leftIcon={<Square className={ICON} strokeWidth={1.75} />} isLoading={aborting} onClick={() => void handleAbort()}>
                Abort run
              </Button>
            )}
            <Button
              variant="secondary"
              data-testid="patrol-run-promote"
              leftIcon={baselineIsThisRun ? <Check className={ICON} strokeWidth={1.75} /> : undefined}
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
          </>
        }
      >
        {run.reason && (
          <p
            className={cn('flex items-start gap-2 text-sm break-words', reasonNeedsAttention ? ATTENTION : 'text-ink-secondary')}
            data-testid="patrol-run-reason"
            data-attention={reasonNeedsAttention ? 'true' : 'false'}
          >
            {reasonNeedsAttention && <AlertTriangle className={cn(ICON, 'mt-0.5 shrink-0')} strokeWidth={1.75} aria-hidden="true" />}
            <span title={run.reason}>{describeRunReason(run.reason)}</span>
          </p>
        )}
      </PageHeader>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3 min-w-0">
        <div className="flex flex-col gap-6 min-w-0 xl:col-span-2">
          <Panel data-testid="patrol-findings">
            <Panel.Header
              title="Findings"
              description={sorted.length > 0 ? `${plural(sorted.length, 'finding', 'findings')} to triage` : undefined}
            />
            <Panel.Body>
              {sorted.length === 0 ? (
                run.mode === 'baseline' ? (
                  <EmptyState size="sm" icon={<CircleSlash />} title="Baseline run" description="A baseline run records what is normal; it raises no findings." />
                ) : (
                  <EmptyState size="sm" icon={<ShieldCheck />} title="Nothing unusual" description="Every checkpoint matched its baseline." />
                )
              ) : (
                <ul className="flex flex-col gap-3">
                  {sorted.map((f) => (
                    <FindingRow
                      key={f.id}
                      finding={f}
                      busy={busyFindingId === f.id}
                      robotNotified={findingRobotNotified[f.id]}
                      onAck={(x) => void handleAck(x)}
                      onNormal={(x) => void handleNormal(x)}
                      onEscalate={(x) => void handleEscalate(x)}
                    />
                  ))}
                </ul>
              )}
            </Panel.Body>
          </Panel>

          <Panel>
            <Panel.Header
              title="Checkpoints"
              description={plural(run.legs.length, 'checkpoint', 'checkpoints')}
              actions={
                baselineIsThisRun ? (
                  <span className="text-xs text-ink-secondary" data-testid="patrol-run-is-baseline">
                    This run is the route's baseline{run.window ? ` for the ${run.window} window` : ''}
                  </span>
                ) : run.mode !== 'baseline' && photoIndexes.size > 0 ? (
                  <SegmentedControl size="sm" options={[...PHOTO_MODES]} value={photoMode} onChange={setPhotoMode} label="Photo comparison mode" />
                ) : undefined
              }
            />
            <Panel.Body>
              {run.legs.length === 0 ? (
                <EmptyState size="sm" icon={<CircleSlash />} title="No checkpoints walked" description="The run was refused before the robot moved." />
              ) : (
                <ol className="flex flex-col gap-3">
                  {run.legs.map((leg) => {
                    const blind = isBlindLeg(leg);
                    const n = leg.findingIds.length;
                    const time = leg.finishedAt ? formatWhen(leg.finishedAt) : leg.startedAt ? formatWhen(leg.startedAt) : '';
                    const name = leg.name || leg.placeId;
                    return (
                      <li
                        key={`${leg.index}-${leg.checkpointId}`}
                        id={`patrol-photo-${leg.index}`}
                        className={cn(INSET_ROW, 'flex flex-col gap-3 min-w-0 scroll-mt-24')}
                        data-testid="patrol-leg"
                        data-index={leg.index}
                        data-status={leg.status}
                      >
                        <div className="flex items-start gap-3 min-w-0">
                          <span
                            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line bg-panel text-xs font-semibold tabular-nums text-ink-secondary"
                            aria-hidden="true"
                          >
                            {leg.index + 1}
                          </span>
                          <div className="flex min-w-0 flex-1 flex-col gap-1">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
                              <span className="text-sm font-medium text-ink-primary truncate">{name}</span>
                              <LegStatusChip status={leg.status} />
                              {time && <span className="ml-auto text-xs text-ink-tertiary tabular-nums">{time}</span>}
                            </div>
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs min-w-0">
                              {leg.inspection && <span className={cn('font-medium', inspectionClass(leg.inspection))}>{INSPECTION_TEXT[leg.inspection]}</span>}
                              {leg.photoDropped === 'person' && <span className="text-ink-tertiary">photo not stored (person)</span>}
                              {n > 0 && <span className={cn(ATTENTION, 'font-medium')}>{plural(n, 'finding', 'findings')}</span>}
                            </div>
                            {leg.message && <p className="text-xs text-ink-tertiary break-words">{leg.message}</p>}
                            {blind && (
                              <p className={cn(NOTE, ATTENTION)} data-testid="patrol-leg-blind">
                                Checkpoint not inspected — {blindReasonText(leg)}, so nothing here was compared with the baseline.
                              </p>
                            )}
                          </div>
                        </div>
                        {photoIndexes.has(leg.index) && (
                          <div className="flex flex-col gap-2">
                            <PhotoPair
                              robotId={run.robotId}
                              checkpointName={name}
                              currentRunId={run.runId}
                              currentKey={leg.photoKey ?? null}
                              currentDropped={leg.photoDropped ?? null}
                              baselineRunId={run.mode === 'baseline' || baselineIsThisRun ? null : (baseline?.runId ?? null)}
                              baselineRobotId={baseline?.robotId ?? run.robotId}
                              baselineKey={run.mode === 'baseline' || baselineIsThisRun ? null : (baseline?.photos?.[leg.checkpointId] ?? null)}
                              baselineMissingText={baselineIsThisRun ? 'this run is the baseline' : undefined}
                              mode={photoMode}
                              className="max-w-3xl"
                            />
                            {blind && (
                              <p className={cn(NOTE, ATTENTION)} data-testid="patrol-photo-blind">
                                Not inspected — no control photo or checklist answer here, so this checkpoint was never compared with the baseline.
                              </p>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}
            </Panel.Body>
          </Panel>
        </div>

        <Panel className="self-start">
          <Panel.Header title="Details" />
          <Panel.Body>
            <KeyValueList columns={1} items={details} />
          </Panel.Body>
        </Panel>
      </div>
    </div>
  );
});
