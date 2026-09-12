/**
 * @file RunDetail.tsx
 * @description One visit as a detail page, the structural twin of the patrol
 *              run: header (tour, date, robot, status; Edit tour), the Q&A
 *              transcript with every turn tagged grounded / from camera /
 *              declined / not answered, the stop timeline with what was said
 *              and what the demo did, a Details panel, and the declined
 *              questions collected as "Facts to add".
 * @feature tour
 */

import { memo, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CircleSlash, MessageCircleQuestion, Pencil } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import {
  EmptyState,
  ErrorState,
  KeyValueList,
  LinkButton,
  PageHeader,
  Panel,
  SkeletonText,
} from '@/shared/components/ui';
import type { TourLeg, TourTurn } from '../types/tour.types';
import { TOUR_RUN_ORIGIN_LABELS } from '../types/tour.types';
import { useTourStore, selectRouteById, selectRunById } from '../store/tourStore';
import { DemoModeBadge, TourLegStatusChip, TourRunStatusChip, TurnAnswerBadge } from './TourBadge';
import { declinedTurns, formatWhen, transcriptState } from '../utils/tourFormat';
import { describeRunReason } from '@/features/patrol/components/opsUi';

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

/** "said 2 of 3" — a stop cut short has to be visible, not inferred from a status. */
function spokenText(leg: TourLeg): string | null {
  if (!leg.spoken) return null;
  return `said ${leg.spoken.said} of ${leg.spoken.of}`;
}

// ============================================================================
// TURN ROW
// ============================================================================

const TurnRow = memo(function TurnRow({ turn, stopName }: { turn: TourTurn; stopName: string | null }) {
  return (
    <li
      className={cn(INSET_ROW, 'flex flex-col gap-1.5', turn.answered === 'declined' && 'border-l-2 border-l-signal-unknown/60')}
      data-testid="tour-turn"
      data-answered={turn.answered}
    >
      <div className="flex flex-wrap items-center gap-2 min-w-0">
        <TurnAnswerBadge answered={turn.answered} />
        <span className="text-xs text-ink-tertiary truncate">{stopName ?? 'not at a stop'}</span>
        <span className="ml-auto text-xs text-ink-tertiary tabular-nums">{formatWhen(turn.at)}</span>
      </div>
      <p className="text-sm font-medium text-ink-primary break-words">{turn.question}</p>
      <p className="text-sm text-ink-secondary break-words">{turn.answer}</p>
      <span className="text-xs text-ink-tertiary uppercase">{turn.language}</span>
    </li>
  );
});

// ============================================================================
// COMPONENT
// ============================================================================

export const RunDetail = memo(function RunDetail({ runId, robotNames = {}, className }: RunDetailProps) {
  const run = useTourStore(selectRunById(runId));
  const status = useTourStore((s) => s.runDetailStatus[runId] ?? 'idle');
  const route = useTourStore(selectRouteById(run?.routeId));
  const error = useTourStore((s) => s.error);

  const fetchRun = useTourStore((s) => s.fetchRun);
  const fetchRoute = useTourStore((s) => s.fetchRoute);

  useEffect(() => {
    if (runId) void fetchRun(runId);
  }, [runId, fetchRun]);

  useEffect(() => {
    if (run?.routeId && !route) void fetchRoute(run.routeId);
  }, [run?.routeId, route, fetchRoute]);

  /**
   * Stop id → the name to print. The RUN's legs win over the route's stops: the
   * route may have been edited (or deleted) since, and the history has to read
   * as what happened, not as what the tour says today.
   */
  const stopNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const stop of route?.stops ?? []) m.set(stop.id, stop.headline || stop.placeId);
    for (const leg of run?.legs ?? []) m.set(leg.stopId, leg.name || leg.placeId);
    return m;
  }, [route, run]);

  const declined = useMemo(() => declinedTurns(run), [run]);
  const back = { to: '/tour', label: 'Guide' };

  if (!run) {
    const loading = runId !== '' && (status === 'loading' || status === 'idle');
    return (
      <div className={cn('flex flex-col gap-6 min-w-0', className)} data-testid="tour-run-detail">
        <PageHeader eyebrow="Automate" back={back} title={loading ? 'Loading…' : 'Visit'} />
        <Panel>
          {loading ? (
            <>
              <SkeletonText lines={4} />
              <p className="sr-only" role="status">Loading visit…</p>
            </>
          ) : (
            <ErrorState
              title="Couldn't load this visit"
              message={(status === 'error' && error) || 'The visit does not exist or is no longer on the robot.'}
              onRetry={runId ? () => void fetchRun(runId) : undefined}
            />
          )}
        </Panel>
      </div>
    );
  }

  const transcript = transcriptState(run);
  const routeName = run.routeName || route?.name || run.routeId;
  const robotName = robotNames[run.robotId] ?? run.robotId;
  const editorPath = `/tour/routes/${encodeURIComponent(run.routeId)}`;
  const reasonNeedsAttention = run.status === 'failed';

  const details = [
    { label: 'Tour', value: <Link to={editorPath} className="text-primary hover:underline">{routeName}</Link> },
    {
      label: 'Robot',
      value: run.robotId ? (
        <Link to={`/agent?robot=${encodeURIComponent(run.robotId)}`} className="text-primary hover:underline" title="Open in Agent Mode">{robotName}</Link>
      ) : null,
    },
    { label: 'Origin', value: TOUR_RUN_ORIGIN_LABELS[run.origin] ?? run.origin },
    { label: 'Language', value: <span className="uppercase">{run.language}</span> },
    { label: 'Started', value: <span className="tabular-nums">{formatWhen(run.startedAt)}</span> },
    { label: 'Finished', value: <span className="tabular-nums">{run.finishedAt ? formatWhen(run.finishedAt) : run.status === 'running' ? 'Still running' : null}</span> },
    { label: 'Duration', value: <span className="tabular-nums">{formatDuration(run.startedAt, run.finishedAt)}</span> },
    { label: 'Questions', value: <span className="tabular-nums">{run.turns.length}</span> },
    { label: 'Run ID', value: run.runId, mono: true },
  ];

  return (
    <div className={cn('flex flex-col gap-6 min-w-0', className)} data-testid="tour-run-detail" data-run-id={run.runId}>
      <PageHeader
        eyebrow="Automate"
        back={back}
        title={routeName}
        description={`Visit · ${formatWhen(run.startedAt)} · ${robotName}`}
        meta={<TourRunStatusChip status={run.status} />}
        actions={
          <LinkButton to={editorPath} variant="secondary" leftIcon={<Pencil className={ICON} strokeWidth={1.75} />}>
            Edit tour
          </LinkButton>
        }
      >
        {run.reason && (
          <p
            className={cn('flex items-start gap-2 text-sm break-words', reasonNeedsAttention ? ATTENTION : 'text-ink-secondary')}
            data-testid="tour-run-reason"
            data-attention={reasonNeedsAttention ? 'true' : 'false'}
          >
            {reasonNeedsAttention && <AlertTriangle className={cn(ICON, 'mt-0.5 shrink-0')} strokeWidth={1.75} aria-hidden="true" />}
            <span title={run.reason}>{describeRunReason(run.reason)}</span>
          </p>
        )}
      </PageHeader>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3 min-w-0">
        <div className="flex flex-col gap-6 min-w-0 xl:col-span-2">
          <Panel data-testid="tour-transcript">
            <Panel.Header title="Questions" description={run.turns.length > 0 ? plural(run.turns.length, 'question', 'questions') : undefined} />
            <Panel.Body>
              {transcript === 'present' ? (
                <ul className="flex flex-col gap-3">
                  {run.turns.map((turn, i) => (
                    <TurnRow key={`${turn.at}-${i}`} turn={turn} stopName={stopNames.get(turn.stopId ?? '') ?? null} />
                  ))}
                </ul>
              ) : transcript === 'swept' ? (
                // Never an empty list here: "no questions" would be a claim about a
                // visitor's conversation that this record can no longer support.
                <p className="text-sm text-ink-tertiary" data-testid="tour-transcript-swept">
                  The transcript has passed its retention window — what was asked on this tour was cleared. The tour itself is kept.
                </p>
              ) : (
                <div data-testid="tour-transcript-empty">
                  <EmptyState size="sm" icon={<MessageCircleQuestion />} title="No questions were asked on this tour." />
                </div>
              )}
            </Panel.Body>
          </Panel>

          <Panel>
            <Panel.Header title="Stops" description={plural(run.legs.length, 'stop', 'stops')} />
            <Panel.Body>
              {run.legs.length === 0 ? (
                <EmptyState size="sm" icon={<CircleSlash />} title="No stops walked" description="The tour ended before the robot walked anywhere." />
              ) : (
                <ol className="flex flex-col gap-3">
                  {run.legs.map((leg) => {
                    const time = leg.finishedAt ? formatWhen(leg.finishedAt) : leg.startedAt ? formatWhen(leg.startedAt) : '';
                    const said = spokenText(leg);
                    return (
                      <li
                        key={`${leg.index}-${leg.stopId}`}
                        className={cn(INSET_ROW, 'flex items-start gap-3 min-w-0')}
                        data-testid="tour-leg"
                        data-index={leg.index}
                        data-status={leg.status}
                      >
                        <span
                          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line bg-panel text-xs font-semibold tabular-nums text-ink-secondary"
                          aria-hidden="true"
                        >
                          {leg.index + 1}
                        </span>
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
                            <span className="text-sm font-medium text-ink-primary truncate">{leg.name || leg.placeId}</span>
                            <TourLegStatusChip status={leg.status} />
                            {time && <span className="ml-auto text-xs text-ink-tertiary tabular-nums">{time}</span>}
                          </div>
                          {said && <span className="text-xs text-ink-tertiary tabular-nums">{said}</span>}
                          {leg.demo && (
                            <div className="flex flex-wrap items-center gap-1.5 text-xs min-w-0" data-testid="tour-leg-demo">
                              <DemoModeBadge mode={leg.demo.mode} />
                              <span className="text-ink-secondary truncate">{leg.demo.skillName}</span>
                              <span className="text-ink-tertiary">
                                {leg.demo.status}
                                {leg.demo.model ? ` · ${leg.demo.model}` : ''}
                                {typeof leg.demo.steps === 'number' ? ` · ${leg.demo.steps} steps` : ''}
                              </span>
                            </div>
                          )}
                          {leg.demo?.message && <p className="text-xs text-ink-tertiary break-words">{leg.demo.message}</p>}
                          {leg.message && <p className="text-xs text-ink-tertiary break-words">{leg.message}</p>}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </Panel.Body>
          </Panel>
        </div>

        <div className="flex flex-col gap-6 min-w-0 self-start">
          <Panel>
            <Panel.Header title="Details" />
            <Panel.Body className="flex flex-col gap-4">
              <KeyValueList columns={1} items={details} />
              {/*
                EU AI Act Art. 50: the visitor has to be told they are talking to an
                AI. The run records whether the sentence actually reached the
                speaker, so this line reports it — a greeting that failed to play
                disclosed nothing, and saying "spoken" anyway would make the
                compliance record a fiction.
              */}
              <p
                className={cn(
                  'text-xs break-words border-l-2 pl-2',
                  run.disclosureSpoken ? 'text-ink-secondary border-signal-measured/50' : cn(ATTENTION, 'border-signal-unknown/50'),
                )}
                data-testid="tour-disclosure"
              >
                {run.disclosureSpoken
                  ? 'AI disclosure spoken to the visitor.'
                  : 'AI disclosure NOT recorded as spoken — the greeting did not reach the speaker.'}
              </p>
            </Panel.Body>
          </Panel>

          {declined.length > 0 && (
            <Panel data-testid="tour-facts-to-add">
              <Panel.Header title="Facts to add" description={plural(declined.length, 'question the tour could not answer', 'questions the tour could not answer')} />
              <Panel.Body className="flex flex-col gap-3">
                <p className="text-xs text-ink-tertiary">
                  The robot said it did not know. Add each fact to its stop and the next visitor gets an answer.
                </p>
                <ul className="flex flex-col gap-2">
                  {declined.map((turn, i) => (
                    <li key={`${turn.at}-${i}`} className="flex flex-col gap-0.5 min-w-0">
                      <span className="text-sm font-medium text-ink-primary break-words">{turn.question}</span>
                      <span className="text-xs text-ink-tertiary">{stopNames.get(turn.stopId ?? '') ?? 'not at a stop'}</span>
                    </li>
                  ))}
                </ul>
                <LinkButton to={editorPath} variant="ghost" size="sm" className="self-start">
                  Add facts in the tour
                </LinkButton>
              </Panel.Body>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
});
