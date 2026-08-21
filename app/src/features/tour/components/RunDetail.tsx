/**
 * @file RunDetail.tsx
 * @description One tour: header (tour, origin, language, whether the AI
 *              disclosure was spoken, times), the stop timeline with what was
 *              said and what the demo did, and the Q&A transcript with every
 *              turn badged grounded / from camera / declined / not answered.
 *              The declined ones are collected into "Facts to add".
 * @feature tour
 */

import { memo, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/shared/utils/cn';
import {
  LEG_NODE,
  PATROL_ATTENTION_TEXT,
  PATROL_FADE_IN,
  PATROL_GLOW_LIVE,
  PATROL_INSET,
  PATROL_MICRO,
  PATROL_MONO,
  PATROL_MOTION,
  PATROL_PANEL,
  PATROL_STICKY_RAIL,
  SectionHeader,
} from '@/features/patrol/components/patrolUi';
import type { TourLeg, TourTurn } from '../types/tour.types';
import { TOUR_RUN_ORIGIN_LABELS } from '../types/tour.types';
import { useTourStore, selectRouteById, selectRunById } from '../store/tourStore';
import { DemoModeBadge, TourLegStatusChip, TourRunStatusChip, TurnAnswerBadge } from './TourBadge';
import { declinedTurns, formatWhen, transcriptState } from '../utils/tourFormat';

export interface RunDetailProps {
  runId: string;
  /** Robot id → display name. */
  robotNames?: Record<string, string>;
  className?: string;
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
      className={cn(PATROL_INSET, PATROL_FADE_IN, 'flex flex-col gap-1.5', turn.answered === 'declined' && 'border-l-[3px] border-l-amber-500')}
      data-testid="tour-turn"
      data-answered={turn.answered}
    >
      <div className="flex flex-wrap items-center gap-2 min-w-0">
        <TurnAnswerBadge answered={turn.answered} />
        <span className="text-[11px] text-theme-tertiary truncate">{stopName ?? 'not at a stop'}</span>
        <span className={cn(PATROL_MONO, 'ml-auto')}>{formatWhen(turn.at)}</span>
      </div>
      <p className="text-sm font-medium text-theme-primary break-words">{turn.question}</p>
      <p className="text-sm text-theme-secondary break-words">{turn.answer}</p>
      <span className={cn(PATROL_MICRO)}>{turn.language}</span>
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
    void fetchRun(runId);
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

  if (!run) {
    const loading = status === 'loading' || status === 'idle';
    return (
      <div className={cn('flex flex-col gap-4 lg:grid lg:grid-cols-[300px_minmax(0,1fr)] lg:gap-5 min-w-0', className)} data-testid="tour-run-detail">
        {loading ? (
          <>
            <div className="flex flex-col gap-4" aria-hidden="true">
              <div className="glass-card rounded-brand-lg animate-pulse h-56" />
              <div className="glass-card rounded-brand-lg animate-pulse h-40" />
            </div>
            <div className="flex flex-col gap-4">
              <div className="glass-card rounded-brand-lg animate-pulse h-64" aria-hidden="true" />
              <p className="sr-only" role="status">
                Loading tour…
              </p>
            </div>
          </>
        ) : (
          <div className={cn(PATROL_PANEL, 'lg:col-span-2 text-center card-meta')}>
            This tour could not be loaded.
            {error && status === 'error' && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
          </div>
        )}
      </div>
    );
  }

  const transcript = transcriptState(run);
  const routeName = run.routeName || route?.name || run.routeId;

  return (
    <div
      className={cn('flex flex-col gap-4 lg:grid lg:grid-cols-[300px_minmax(0,1fr)] lg:gap-5 min-w-0', className)}
      data-testid="tour-run-detail"
      data-run-id={run.runId}
    >
      {/* Left rail: header + stop timeline */}
      <aside className={cn(PATROL_STICKY_RAIL, 'flex flex-col gap-4 min-w-0')}>
        <header className={cn(PATROL_PANEL, 'flex flex-col gap-3', run.status === 'running' && PATROL_GLOW_LIVE)}>
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <TourRunStatusChip status={run.status} />
            {run.robotId && (
              <Link
                to={`/agent?robot=${encodeURIComponent(run.robotId)}`}
                className={cn('ml-auto text-xs text-cobalt-600 dark:text-cobalt-400 hover:underline', PATROL_MOTION)}
              >
                Agent Mode
              </Link>
            )}
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-lg font-semibold leading-tight text-theme-primary break-words">
              <Link to={`/tour/routes/${encodeURIComponent(run.routeId)}`} className={cn('hover:text-cobalt-500', PATROL_MOTION)}>
                {routeName}
              </Link>
            </h2>
            <p className="text-xs text-theme-secondary break-words">{TOUR_RUN_ORIGIN_LABELS[run.origin] ?? run.origin}</p>
          </div>
          {run.reason && (
            <p className={cn('text-sm break-words', run.status === 'failed' ? PATROL_ATTENTION_TEXT : 'text-theme-secondary')} data-testid="tour-run-reason">
              {run.reason}
            </p>
          )}
          <dl className="grid grid-cols-2 lg:grid-cols-[auto_1fr] gap-x-3 gap-y-1 min-w-0">
            <dt className={PATROL_MICRO}>Language</dt>
            <dd className={cn(PATROL_MONO, 'truncate')}>{run.language}</dd>
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
            <dt className={PATROL_MICRO}>Questions</dt>
            <dd className={cn(PATROL_MONO, 'truncate')}>{run.turns.length}</dd>
          </dl>
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
              run.disclosureSpoken
                ? 'text-theme-secondary border-l-turquoise-500/60'
                : cn(PATROL_ATTENTION_TEXT, 'border-l-amber-500/60')
            )}
            data-testid="tour-disclosure"
          >
            {run.disclosureSpoken
              ? 'AI disclosure spoken to the visitor.'
              : 'AI disclosure NOT recorded as spoken — the greeting did not reach the speaker.'}
          </p>
        </header>

        {/* Stops */}
        <section className={cn(PATROL_PANEL, 'flex flex-col gap-3')}>
          <SectionHeader as="h3" title="Stops" count={run.legs.length} />
          {run.legs.length === 0 ? (
            <p className="card-meta text-xs">No stops — the tour ended before the robot walked anywhere.</p>
          ) : (
            <ol className="relative flex flex-col gap-2.5 before:absolute before:left-[11px] before:top-3 before:bottom-3 before:w-px before:bg-[var(--glass-border-highlight)]">
              {run.legs.map((leg) => {
                const time = leg.finishedAt ? formatWhen(leg.finishedAt) : leg.startedAt ? formatWhen(leg.startedAt) : '';
                const said = spokenText(leg);
                return (
                  <li key={`${leg.index}-${leg.stopId}`} className="min-w-0" data-testid="tour-leg" data-index={leg.index} data-status={leg.status}>
                    <div className="flex items-start gap-2 py-0.5">
                      <span
                        className={cn(
                          'relative z-[1] shrink-0 w-6 h-6 rounded-full inline-flex items-center justify-center text-[11px] font-semibold tabular-nums',
                          PATROL_MOTION,
                          LEG_NODE[leg.status]
                        )}
                        aria-hidden="true"
                      >
                        {leg.index + 1}
                      </span>
                      <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
                          <span className="text-sm font-medium text-theme-primary truncate">{leg.name || leg.placeId}</span>
                          <TourLegStatusChip status={leg.status} />
                          {time && <span className={cn(PATROL_MONO, 'ml-auto text-[11px]')}>{time}</span>}
                        </span>
                        {said && <span className="text-[11px] text-theme-tertiary">{said}</span>}
                        {leg.demo && (
                          <span className="flex flex-wrap items-center gap-1.5 text-[11px] min-w-0" data-testid="tour-leg-demo">
                            <DemoModeBadge mode={leg.demo.mode} />
                            <span className="text-theme-secondary truncate">{leg.demo.skillName}</span>
                            <span className="text-theme-tertiary">
                              {leg.demo.status}
                              {leg.demo.model ? ` · ${leg.demo.model}` : ''}
                              {typeof leg.demo.steps === 'number' ? ` · ${leg.demo.steps} steps` : ''}
                            </span>
                          </span>
                        )}
                        {leg.demo?.message && <span className="card-meta text-xs break-words">{leg.demo.message}</span>}
                        {leg.message && <span className="card-meta text-xs break-words">{leg.message}</span>}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </aside>

      {/* Right column: what the visitor asked — the reason this page exists. */}
      <div className="flex flex-col gap-4 min-w-0">
        {declined.length > 0 && (
          <section className={cn(PATROL_PANEL, 'flex flex-col gap-2 border-l-[3px] border-l-amber-500')} data-testid="tour-facts-to-add">
            <SectionHeader as="h3" title="Facts to add" count={declined.length} />
            <p className="card-meta text-xs">
              The robot said it did not know. Each of these is a fact the tour does not carry yet — add it to the stop and the next visitor gets an answer.
            </p>
            <ul className="flex flex-col gap-1.5">
              {declined.map((turn, i) => (
                <li key={`${turn.at}-${i}`} className="text-sm text-theme-primary break-words flex flex-wrap gap-x-2 min-w-0">
                  <span className="font-medium">{turn.question}</span>
                  <span className="text-[11px] text-theme-tertiary self-center">{stopNames.get(turn.stopId ?? '') ?? 'not at a stop'}</span>
                </li>
              ))}
            </ul>
            <Link
              to={`/tour/routes/${encodeURIComponent(run.routeId)}`}
              className={cn('text-xs text-cobalt-600 dark:text-cobalt-400 hover:underline self-start', PATROL_MOTION)}
            >
              Edit this tour →
            </Link>
          </section>
        )}

        <section className={cn(PATROL_PANEL, 'flex flex-col gap-3')} data-testid="tour-transcript">
          <SectionHeader as="h3" title="Questions" count={run.turns.length} />
          {transcript === 'present' ? (
            <ul className="flex flex-col gap-2">
              {run.turns.map((turn, i) => (
                <TurnRow key={`${turn.at}-${i}`} turn={turn} stopName={stopNames.get(turn.stopId ?? '') ?? null} />
              ))}
            </ul>
          ) : transcript === 'swept' ? (
            // Never an empty list here: "no questions" would be a claim about a
            // visitor's conversation that this record can no longer support.
            <p className="card-meta text-xs" data-testid="tour-transcript-swept">
              The transcript has passed its retention window — what was asked on this tour was cleared. The tour itself is kept.
            </p>
          ) : (
            <p className="card-meta text-xs" data-testid="tour-transcript-empty">
              No questions were asked on this tour.
            </p>
          )}
        </section>
      </div>
    </div>
  );
});
