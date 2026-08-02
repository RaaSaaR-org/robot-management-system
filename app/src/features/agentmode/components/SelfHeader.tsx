/**
 * @file SelfHeader.tsx
 * @description The identity chip in the status rail: which robot this is, what
 *              it has been through, and HOW OLD that answer is —
 *              `Nova · recovered from crash · 4s ago`. The numbers that age
 *              qualifies (incarnation, uptime, battery, operator, site) sit one
 *              click away in the details drawer this chip opens.
 * @feature agentmode
 */

import { memo, useEffect, useState } from 'react';
import { cn } from '@/shared/utils';
import { Tooltip } from '@/shared/components/ui/Tooltip';
import {
  useAgentModeStore,
  selectSelf,
  selectSelfAgeUnknown,
  selectSelfLive,
  selectSelfSuperseded,
  selectSelfUpdatedAt,
} from '../store/agentmodeStore';
import type { AgentSelfState } from '../types/agentmode.types';
import { IdentityDialog } from './IdentityDialog';
import { RobotDetailsDrawer } from './RobotDetailsDrawer';

export interface SelfHeaderProps {
  /** Robot to name when the bootstrap badge is used; null disables the action. */
  robotId?: string | null;
  className?: string;
}

/**
 * Past this, the snapshot stops being "what the robot is doing" and becomes
 * "what the robot was doing". Chosen against the push rate: the agent reports a
 * state change on every plan, block and mode transition, so a minute of silence
 * on a page an operator is watching already means nothing is happening — or
 * nothing is arriving, which is the case this exists to expose.
 */
const STALE_AFTER_MS = 60_000;

/** How often the age label re-renders. Coarse on purpose — this is not a clock. */
const AGE_TICK_MS = 10_000;

/**
 * NOTE — what used to be here, and where it went.
 *
 * This file used to render a clause line:
 * `Nova · incarnation 47 · AISLE-3 · operator Sebastian · dz-226 Lab · 4s ago`.
 * Every one of those clauses still exists, none of the honesty rules behind
 * them were dropped, but they are no longer read on every glance:
 *
 * - `incarnationClause` — moved VERBATIM into `RobotDetailsDrawer`, including
 *   the exact-vs-lower-bound rule ("at least 197 starts", never "incarnation
 *   197", because a lower bound rendered as an ordinal reads as a count).
 * - the place — DELETED here. `PlaceChip` is the single renderer of the place
 *   belief, and it renders unknown as a dashed chip rather than as a place.
 *   Two renderers of one belief is how the two drift apart, and this is the
 *   one belief where drift means an operator sends a robot from the wrong
 *   room. This file must not grow it back.
 * - operator and site — moved to the drawer's identity section.
 *
 * What stays is what an operator has to be able to read WITHOUT clicking: who
 * this is, how old the answer is, and the two conditions they must act on.
 */

/**
 * How the previous life ended, when it ended badly.
 *
 * Only `crash` gets its own visually distinct clause: it is the one field on
 * this line an operator acts on — a robot that came back from a kill may have
 * lost state its lineage cannot reconstruct, and it refuses self-initiated
 * motion until someone acknowledges it.
 */
function crashClause(self: AgentSelfState): string | null {
  const shutdown = self.lastShutdown;
  if (!shutdown || shutdown.exit !== 'crash') return null;
  return shutdown.place ? `recovered from crash in ${shutdown.place}` : 'recovered from crash';
}

/** Age of the snapshot in ms, re-computed on a coarse tick; null when unknown. */
function useSnapshotAge(updatedAt: string | null): number | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!updatedAt) return;
    // A new snapshot resets the clock immediately; the interval only keeps a
    // page nobody touches from claiming the data is younger than it is.
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), AGE_TICK_MS);
    return () => clearInterval(id);
  }, [updatedAt]);

  if (!updatedAt) return null;
  const taken = new Date(updatedAt).getTime();
  if (Number.isNaN(taken)) return null;
  // A robot's clock is not this browser's clock, so a snapshot can arrive
  // "from the future". Clamp rather than render a negative age.
  return Math.max(0, now - taken);
}

/** Compact age, seconds-resolution near zero — "12s ago" reads as live, "4 min ago" does not. */
function formatAge(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

/** The robot's own uptime at the moment of the snapshot, in words. */
function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return 'unknown';
  if (seconds < 90) return `${Math.round(seconds)}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} d`;
}

/**
 * How old this line is, and whether it came from the robot or from a cache.
 *
 * The page reads Agent Mode state from the SERVER's in-memory mirror, which
 * only moves when the robot pushes an event — it has been observed reporting a
 * different incarnation, battery and uptime than the robot itself. Rendering
 * `incarnation 200` with nothing next to it presents a cached number as a
 * measurement on a safety surface.
 *
 * It stays quiet while the data is fresh (muted, no icon, no colour): a badge
 * that always warns is a badge people stop reading. It goes amber and says
 * "cached" only once the snapshot is genuinely old.
 */
function FreshnessClause({
  self,
  updatedAt,
  live,
}: {
  self: AgentSelfState;
  updatedAt: string;
  live: boolean;
}) {
  const age = useSnapshotAge(updatedAt);
  if (age === null) return null;

  const stale = age >= STALE_AFTER_MS;
  const receivedAt = new Date(updatedAt);
  const clock = Number.isNaN(receivedAt.getTime())
    ? updatedAt
    : receivedAt.toLocaleTimeString();

  return (
    <Tooltip
      side="bottom"
      content={
        <>
          {live
            ? `The robot itself reported this at ${clock}.`
            : `Read from the server's mirror at ${clock}. The mirror only moves when the ` +
              'robot pushes an event, so it can sit behind the robot — including on ' +
              'incarnation, battery and uptime.'}{' '}
          {`The robot had been up ${formatUptime(self.uptimeS)} at that point.`}
        </>
      }
    >
      <span
        data-testid="agent-self-freshness"
        data-stale={String(stale)}
        data-live={String(live)}
        className={cn(
          'tabular-nums',
          stale ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-theme-muted'
        )}
      >
        · {stale && !live ? 'cached · ' : ''}
        {formatAge(age)}
      </span>
    </Tooltip>
  );
}

/**
 * A mirrored snapshot the server could not date.
 *
 * Rendered exactly as loudly as an old one, and on purpose: "we do not know how
 * old this is" is not better news than "this is five minutes old". The one
 * thing it must never look like is fresh — silently omitting the clause would
 * leave the operator reading a battery percentage and an incarnation number
 * with nothing beside them, which is how they read a live measurement.
 */
function UnknownAgeClause({ self }: { self: AgentSelfState }) {
  return (
    <Tooltip
      side="bottom"
      content={
        <>
          {'Read from the server’s mirror, which did not report when it last heard from ' +
            'the robot. The mirror only moves when the robot pushes an event, so this may be ' +
            'the last thing an earlier process said — including its incarnation, battery and ' +
            'uptime. '}
          {`The robot had been up ${formatUptime(self.uptimeS)} when this was taken.`}
        </>
      }
    >
      <span
        data-testid="agent-self-freshness"
        data-stale="true"
        data-live="false"
        className="tabular-nums text-amber-600 dark:text-amber-400 font-medium"
      >
        · cached · age unknown
      </span>
    </Tooltip>
  );
}

/** The disclosure arrow on the identity chip — a shape, so it is aria-hidden. */
function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

export const SelfHeader = memo(function SelfHeader({ robotId, className }: SelfHeaderProps) {
  const self = useAgentModeStore(selectSelf);
  const updatedAt = useAgentModeStore(selectSelfUpdatedAt);
  const live = useAgentModeStore(selectSelfLive);
  const ageUnknown = useAgentModeStore(selectSelfAgeUnknown);
  const superseded = useAgentModeStore(selectSelfSuperseded);
  const [naming, setNaming] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  // Absent self AND no robot bound: nothing to identify and nothing whose
  // details could be opened. The line is omitted rather than rendered with
  // placeholders that would read as facts.
  if (!self && !robotId) return null;

  const crash = self ? crashClause(self) : null;

  return (
    <>
      <p
        data-testid="agent-self-header"
        className={cn('card-meta flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0', className)}
      >
        {self ? (
          <>
            {/* The name is the door into everything this chip stopped saying
                out loud. It is a button so that the identity, the snapshot's
                provenance and — the load-bearing one — the full condition
                checklist are one click away: a page that only shows badges when
                something is wrong cannot be told apart from a page whose badges
                are broken. */}
            <button
              type="button"
              data-testid="agent-self-name"
              onClick={() => setDetailsOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={detailsOpen}
              title="Identity, snapshot and the full condition checklist"
              className={cn(
                'inline-flex items-center gap-1 rounded-brand px-1 -mx-1 min-w-0 max-w-[14rem]',
                'text-theme-secondary font-medium hover:text-theme-primary transition-colors',
                'pointer-coarse:min-h-11',
                'focus:outline-none focus:ring-2 focus:ring-cobalt-500/40'
              )}
            >
              {/* An operator-chosen name has no length limit. It ellipsises
                  rather than growing the rail past the point where STOPP has to
                  wrap — the drawer this button opens spells it out in full. */}
              <span className="truncate min-w-0">
                {self.emoji ? `${self.emoji} ` : ''}
                {self.name}
              </span>
              <ChevronDownIcon className="w-3 h-3 shrink-0 text-theme-muted" />
            </button>
            {/* SIBLING of the name button, never nested inside it: a button
                within a button is invalid markup and leaves keyboard and
                screen-reader users unable to reach the inner one. Two flat
                controls, no stopPropagation standing between them and the
                operator. */}
            {self.bootstrapRequired && (
              // The badge is the door into the naming ritual, not a label about
              // it: a robot that is asking to be named has to be nameable from
              // the page that says so, without talking to it.
              <button
                type="button"
                data-testid="agent-self-unnamed"
                onClick={() => setNaming(true)}
                disabled={!robotId}
                title={
                  robotId
                    ? 'Write a name, operator and site into this robot’s IDENTITY.md'
                    : 'Select a robot first'
                }
                className={cn(
                  'text-amber-600 dark:text-amber-400 underline underline-offset-2',
                  'rounded-brand px-1 -mx-1 pointer-coarse:min-h-11 pointer-coarse:px-2',
                  'hover:text-amber-700 dark:hover:text-amber-300',
                  'focus:outline-none focus:ring-2 focus:ring-amber-500/40',
                  'disabled:no-underline disabled:cursor-not-allowed disabled:opacity-60'
                )}
              >
                · not named yet — name it
              </button>
            )}
            {crash && (
              <span
                data-testid="agent-self-crash"
                className="text-amber-600 dark:text-amber-400 font-medium"
              >
                · {crash}
              </span>
            )}
            {updatedAt ? (
              <FreshnessClause self={self} updatedAt={updatedAt} live={live} />
            ) : ageUnknown ? (
              <UnknownAgeClause self={self} />
            ) : null}
            {superseded && (
              // Not a degree of staleness — a different robot process. The
              // bootId beside it is the evidence, and it is what someone chasing
              // a duplicate agent on the box actually needs.
              <span
                data-testid="agent-self-superseded"
                title={`This snapshot was pushed by boot ${self.bootId ?? 'unknown'}, but the robot last answered from a different one.`}
                className="text-amber-600 dark:text-amber-400 font-medium"
              >
                · from a different process than last answered
              </span>
            )}
            <span className="sr-only">{self.unit}</span>
          </>
        ) : (
          // A robot is bound but has not said who it is — which is exactly the
          // state in which the condition checklist matters MOST: with no self,
          // the rail carries no badges at all, and "no badges" is
          // indistinguishable from "the badges are broken". Without a trigger
          // here the drawer, and with it the only place that lists all seven
          // conditions including the false ones, would be unreachable on the
          // very page an unreachable robot is being diagnosed from.
          //
          // No name is invented for it: the button says what it opens, not who
          // the robot is.
          <button
            type="button"
            onClick={() => setDetailsOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={detailsOpen}
            title="Identity, snapshot and the full condition checklist"
            className={cn(
              'inline-flex items-center gap-1 rounded-brand px-1 -mx-1',
              'text-theme-secondary font-medium hover:text-theme-primary transition-colors',
              'pointer-coarse:min-h-11',
              'focus:outline-none focus:ring-2 focus:ring-cobalt-500/40'
            )}
          >
            Robot details
            <ChevronDownIcon className="w-3 h-3 shrink-0 text-theme-muted" />
          </button>
        )}
      </p>

      {/* Both stay MOUNTED while closed — they render nothing then, and each
          owns state (the naming form's draft, the drawer's own dialog) that has
          to survive the other closing underneath it. */}
      <RobotDetailsDrawer
        isOpen={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        robotId={robotId ?? null}
      />
      <IdentityDialog isOpen={naming} onClose={() => setNaming(false)} robotId={robotId ?? null} />
    </>
  );
});
