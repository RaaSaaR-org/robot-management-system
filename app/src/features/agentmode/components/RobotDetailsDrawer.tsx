/**
 * @file RobotDetailsDrawer.tsx
 * @description Everything the status rail moved out of the way: who this robot
 *              is, how old the snapshot those numbers came from is, and the
 *              full condition checklist that proves a calm rail is calm.
 * @feature agentmode
 */

import { useEffect, useState, type ReactNode } from 'react';
import { cn } from '@/shared/utils';
import { formatTimeAgo } from '@/shared/utils/format';
import { Button, Modal } from '@/shared/components/ui';
import {
  useAgentModeStore,
  selectSelf,
  selectSelfAgeUnknown,
  selectSelfLive,
  selectSelfSuperseded,
  selectSelfUpdatedAt,
} from '../store/agentmodeStore';
import type { AgentModeStore, AgentSelfState } from '../types/agentmode.types';
import {
  CONDITION_ACTIVE_HEADLINE,
  CONDITION_CLEAR_HEADLINE,
  CONDITION_LABELS,
  selectConditions,
} from '../utils/conditions';
import type { Condition } from '../utils/conditions';
import { IdentityDialog } from './IdentityDialog';

export interface RobotDetailsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  /** Robot to name from the footer; null disables that button. */
  robotId?: string | null;
}

/**
 * The bootId of the process that last answered us DIRECTLY — the reference the
 * superseded flag is decided against, and the other half of the evidence
 * anybody chasing a duplicate agent on the box needs. No named selector exists
 * for it; this is a field read, not a derivation.
 */
const selectSelfLiveBootId = (state: AgentModeStore) => state.selfLiveBootId;

/**
 * Which life this is, said as precisely as the robot can support it.
 *
 * `incarnationExact: false` means the number is a LOWER BOUND — the lineage
 * file rotated past boots nothing on the robot's disk can account for — and a
 * bound rendered as "incarnation 197" reads to an operator as a count of
 * starts. It is not one, so it does not get to look like one. Kept verbatim
 * from `SelfHeader`, which no longer renders it: the chip in the rail is the
 * name and the age, the numbers those qualify live here.
 */
function incarnationClause(self: AgentSelfState): string {
  return self.incarnationExact === true
    ? `incarnation ${self.incarnation}`
    : `at least ${self.incarnation} starts`;
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

/** Local date-time, or the raw ISO string when it cannot be parsed. */
function formatClock(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="card-title">{title}</h3>
      <div className="space-y-1.5">{children}</div>
    </section>
  );
}

/**
 * One label/value pair. `unset` is for a field the robot's card genuinely does
 * not carry — rendered as "not set" in muted type, never as an empty value the
 * eye fills in and never as the word "unknown", which is a different answer.
 */
function Row({
  label,
  value,
  unset = false,
}: {
  label: string;
  value: ReactNode;
  unset?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 text-sm">
      <span className="card-meta shrink-0 w-32">{label}</span>
      <span
        className={cn('min-w-0 break-words', unset ? 'card-meta' : 'text-theme-secondary')}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * How often the checklist re-reads the clock while it is open.
 *
 * Deliberately the same coarse 10s tick as `SelfHeader`'s freshness clause, and
 * for the same reason it exists there: `stale` is derived from `Date.now()`, and
 * TIME PASSING IS NOT A STORE EVENT. A zustand selector only re-runs when the
 * store publishes — and a robot going quiet is precisely the case where nothing
 * publishes. Without this the drawer could sit open reading "Snapshot age —
 * clear" while the freshness badge two inches away had already gone amber, which
 * is the one thing this checklist may never do: assert clear about a condition
 * that is visibly true on the page it is vouching for.
 */
const CONDITION_TICK_MS = 10_000;

/**
 * Every condition this page can raise, with its current value.
 *
 * This is the list that makes a quiet page trustworthy. Badges that only appear
 * when something is wrong cannot be told apart from badges that are broken, so
 * an operator who wants to know whether the robot is really clear has somewhere
 * to go and read every answer — including, and especially, the false ones.
 *
 * The count is never written out in prose: it is rendered from the list itself,
 * because a hard-coded "all seven" above an eight-row list turns the one check
 * this section exists to support into the wrong answer.
 */
function ConditionChecklist({ conditions }: { conditions: readonly Condition[] }) {
  return (
    <ul className="space-y-1.5">
      {conditions.map((condition) => (
        <li key={condition.key} className="flex items-start gap-3 text-sm">
          <span className="card-meta shrink-0 w-32">{CONDITION_LABELS[condition.key]}</span>
          <span
            className={cn(
              'min-w-0 break-words',
              !condition.active && 'card-meta',
              condition.active && condition.level >= 3 && 'text-red-600 dark:text-red-400',
              condition.active &&
                condition.level === 2 &&
                'text-amber-600 dark:text-amber-400',
              condition.active && condition.level <= 1 && 'text-theme-secondary'
            )}
          >
            {condition.active
              ? CONDITION_ACTIVE_HEADLINE[condition.key]
              : CONDITION_CLEAR_HEADLINE[condition.key]}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Who this robot is, how old that answer is, and what is true about it right
 * now — opened from the identity chip in the status rail.
 *
 * Everything in here used to sit on the page as a permanently visible clause
 * line. It is not less important for being one click away; it is simply not
 * something an operator reads on every glance, and a rail that says everything
 * at once is a rail nobody reads at all. The two things that must never be in
 * here — the freshness clause and the safety controls — are not.
 *
 * Keep it MOUNTED while closed: it renders nothing then, and it owns the
 * naming dialog, which has to survive this drawer closing underneath it.
 */
export function RobotDetailsDrawer({ isOpen, onClose, robotId }: RobotDetailsDrawerProps) {
  const self = useAgentModeStore(selectSelf);
  const updatedAt = useAgentModeStore(selectSelfUpdatedAt);
  const live = useAgentModeStore(selectSelfLive);
  const ageUnknown = useAgentModeStore(selectSelfAgeUnknown);
  const superseded = useAgentModeStore(selectSelfSuperseded);
  const liveBootId = useAgentModeStore(selectSelfLiveBootId);
  const [naming, setNaming] = useState(false);

  // Forces the render that re-reads the clock; see CONDITION_TICK_MS. Only
  // while open — a closed drawer renders nothing and has nothing to keep true.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!isOpen) return;
    const id = setInterval(() => setTick((value) => value + 1), CONDITION_TICK_MS);
    return () => clearInterval(id);
  }, [isOpen]);

  // Read AFTER the ticker so the re-render it forces re-evaluates the selector
  // against a current `Date.now()`.
  const conditions = useAgentModeStore(selectConditions);

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={self ? `${self.emoji ? `${self.emoji} ` : ''}${self.name}` : 'Robot details'}
        size="md"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={!robotId}
              onClick={() => {
                // One dialog at a time: the naming form is itself a modal, and
                // stacking two of them leaves the escape key and the focus
                // trap arguing about which one they belong to.
                setNaming(true);
                onClose();
              }}
            >
              Name this robot
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          {!self ? (
            // Absent means the agent does not report a self — which is not the
            // same as a robot without an identity, and must not be filled in
            // with placeholders that would read as facts.
            <p className="card-meta">
              This robot has not reported who it is. That is not the same as a robot
              without an identity — one that genuinely has none says so and asks to be
              named.
            </p>
          ) : (
            <>
              <Section title="Identity">
                <Row label="Name" value={self.name} />
                <Row label="Unit" value={self.unit} />
                <Row
                  label="Operator"
                  value={self.operator ?? 'not set'}
                  unset={!self.operator}
                />
                <Row label="Site" value={self.site ?? 'not set'} unset={!self.site} />
                <Row label="Life" value={incarnationClause(self)} />
                <Row
                  label="Boot id"
                  value={
                    self.bootId ? (
                      <span className="font-mono text-xs">{self.bootId}</span>
                    ) : (
                      'not reported'
                    )
                  }
                  unset={!self.bootId}
                />
                {self.bootstrapRequired && (
                  <Row
                    label="IDENTITY.md"
                    value="not written yet — this robot has not been named"
                    unset
                  />
                )}
                <p className="card-meta pt-1">Plans are ephemeral and never persisted.</p>
              </Section>

              <Section title="Snapshot">
                {/* The age qualifies every number above it, so it is said here
                    in full: when it was taken, and whether the robot itself
                    said it or it was read out of the server's mirror. */}
                <Row
                  label="Taken"
                  value={
                    updatedAt
                      ? `${formatClock(updatedAt)} · ${formatTimeAgo(updatedAt)}`
                      : ageUnknown
                        ? 'age unknown'
                        : 'nothing received yet'
                  }
                  unset={!updatedAt}
                />
                <Row
                  label="Source"
                  value={
                    live
                      ? 'The robot itself reported this.'
                      : "Read from the server's mirror, which only moves when the robot pushes an event — it can sit behind the robot, including on incarnation, battery and uptime."
                  }
                />
                <Row label="Uptime then" value={formatUptime(self.uptimeS)} />
                <Row
                  label="Battery then"
                  value={self.batteryPct === null ? 'not reported' : `${self.batteryPct}%`}
                  unset={self.batteryPct === null}
                />
                {superseded && (
                  // Not a degree of staleness — a different robot process. Two
                  // bootIds is the evidence, and it is what somebody chasing a
                  // duplicate agent on the box actually needs.
                  <Row
                    label="Process"
                    value={
                      <span className="text-amber-600 dark:text-amber-400">
                        Pushed by boot{' '}
                        <span className="font-mono text-xs">{self.bootId ?? 'unknown'}</span>,
                        but the robot last answered from{' '}
                        <span className="font-mono text-xs">{liveBootId ?? 'another one'}</span>
                        .
                      </span>
                    }
                  />
                )}
              </Section>
            </>
          )}

          <Section title="Conditions">
            <p className="card-meta">
              All {conditions.length}, whether they are true or not — so a badge missing from
              the page can be read here as false rather than broken.
            </p>
            <ConditionChecklist conditions={conditions} />
          </Section>
        </div>
      </Modal>

      <IdentityDialog
        isOpen={naming}
        onClose={() => setNaming(false)}
        robotId={robotId ?? null}
      />
    </>
  );
}
