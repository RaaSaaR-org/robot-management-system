/**
 * @file EstopBanner.tsx
 * @description The condition stack — one line per thing that is wrong RIGHT NOW:
 *              whether the stop was only requested, actually acknowledged by the
 *              robot, or failed, whether the base is still damped and therefore
 *              cannot locomote, what this boot inherited from the last one, and,
 *              when the robot could not be reached at all, that its latch
 *              position is simply UNKNOWN — plus, last and quietest, the console's
 *              own failed request.
 * @feature agentmode
 */

import { Fragment, memo, useId, useState, type ReactNode } from 'react';
import { cn } from '@/shared/utils';
import {
  useAgentModeStore,
  selectDamped,
  selectEstopActive,
  selectEstopStatus,
  selectEstopError,
  selectFsmId,
  selectRecovered,
  selectStateUnavailableReason,
  selectStateUnknown,
} from '../store/agentmodeStore';
import { CONDITION_ORDER, type ConditionKey } from '../utils/conditions';
import type { AgentEstopStatus, AgentRecoveryState } from '../types/agentmode.types';

export interface EstopBannerProps {
  /** Clear the latch. Wired to the store's `resetEstop` by the page. */
  onReset: () => void;
  /**
   * The last request this console made and how it failed. It is NOT a claim
   * about the robot, which is why it is the last and quietest line here rather
   * than a banner of its own above the page.
   */
  error?: string | null;
  /** Wired to the store's `clearError`. Omitted ⇒ no Dismiss control. */
  onDismissError?: () => void;
  className?: string;
}

interface BannerCopy {
  title: string;
  detail: string;
  /** Ring/dot colour classes — amber while unverified, red once it is real. */
  accent: string;
  dot: string;
  border: string;
}

/**
 * Manual E-Stop is the only safety mechanism in v1, so the banner must never
 * state more than is known. "Stopped and damped" is a claim about the robot and
 * is only allowed once the agent acknowledged the stop.
 *
 * @param stateUnknown - The robot cannot be reached right now. An acknowledgement
 *                       it gave earlier still happened, but it is history: the
 *                       present tense ("it is stopped and damped") is no longer
 *                       something this console can back.
 */
function copyFor(
  status: AgentEstopStatus,
  error: string | null,
  stateUnknown: boolean
): BannerCopy {
  if (stateUnknown && (status === 'acknowledged' || status === 'idle')) {
    return {
      title: 'E-Stop latched — no longer confirmed',
      // Ordered the same way as the other three notices, and for the same
      // reason: the clamp shows exactly the first sentence. Leading with "the
      // robot confirmed this stop" put the reassuring half on screen and left
      // the load-bearing half — that nobody can verify it is still stopped —
      // behind the disclosure, under a title that was then the only thing on
      // the line carrying the truth.
      detail:
        'It is not answering now, so whether it is still stopped cannot be verified ' +
        'from here. The robot confirmed this stop while it was still reachable. ' +
        'Commands from this console stay refused.',
      accent: 'text-amber-600 dark:text-amber-400',
      dot: 'bg-amber-500',
      border: 'border-amber-500/50',
    };
  }

  switch (status) {
    case 'requesting':
      return {
        title: 'E-Stop requested',
        detail:
          'Sent to the robot — not confirmed yet. Do not assume it has stopped. ' +
          'Commands from this console are already refused.',
        accent: 'text-amber-600 dark:text-amber-400',
        dot: 'bg-amber-500',
        border: 'border-amber-500/50',
      };
    case 'failed':
      return {
        title: 'E-Stop NOT confirmed',
        detail: error
          ? `The stop request never reached the robot: ${error} — it may still be moving. ` +
            'Use the hardware E-Stop. This console keeps refusing commands.'
          : 'The stop request never reached the robot — it may still be moving. ' +
            'Use the hardware E-Stop. This console keeps refusing commands.',
        accent: 'text-red-600 dark:text-red-400',
        dot: 'bg-red-500',
        border: 'border-red-500',
      };
    case 'unconfirmed':
      return {
        title: 'E-Stop NOT confirmed by the robot',
        detail: error
          ? `The stop latched in software, but the robot did not confirm it: ${error} — ` +
            'it may still be moving. Use the hardware E-Stop. This console keeps refusing commands.'
          : 'The stop latched in software, but the robot did not confirm StopMove/Damp — ' +
            'it may still be moving. Use the hardware E-Stop. This console keeps refusing commands.',
        accent: 'text-red-600 dark:text-red-400',
        dot: 'bg-red-500',
        border: 'border-red-500',
      };
    // `idle` is unreachable while the latch is set (every path that sets it also
    // sets a status), but a latch reported by the agent is an acknowledged one.
    case 'idle':
    case 'acknowledged':
    default:
      return {
        title: 'E-Stop latched',
        detail:
          'The robot confirmed the stop: it is stopped and damped. ' +
          'Commands are refused until the latch is cleared.',
        accent: 'text-red-600 dark:text-red-400',
        dot: 'bg-red-500',
        border: 'border-red-500/40',
      };
  }
}

/**
 * Touch-target rule for the two buttons on this banner, identical to the STOPP
 * button's in `BlockTimeline`: >=44px on coarse pointers (Apple HIG / WCAG
 * 2.5.5), the compact bar on fine-pointer desktops. These are the E-Stop reset
 * and the crash acknowledgement — the controls an operator reaches for in a
 * hurry, on whatever device is in their hand.
 *
 * They sit on the ALWAYS-VISIBLE part of their line. Nothing here is ever moved
 * behind the disclosure: the failure this defends against is someone deleting
 * the robot's state file to unstick a refusal to move, and that person needs the
 * button in one click, not in two.
 */
const SAFETY_BUTTON =
  'ml-auto btn-secondary !px-3 !py-1.5 !text-xs ' +
  'pointer-coarse:min-h-11 pointer-coarse:!px-5 pointer-coarse:!text-sm';

/**
 * One notice is one line, and the line collapses in a fixed order.
 *
 * `flex-wrap` with a full-basis detail is the whole responsive story: at >=640px
 * the detail takes the leftover width and clamps to a single line; below that it
 * drops to its own row so a 390px phone shows the title, then the sentence, then
 * the button — wrapped, never clipped, and never scrolled sideways out of reach.
 * `items-start` keeps the title and the buttons anchored to the first line while
 * an expanded detail grows downwards.
 */
const NOTICE_ROW =
  'glass-card px-3 py-2 flex flex-wrap items-start gap-x-3 gap-y-1.5';

/** Aligns the 8px dot with the centre of the first 20px text line. */
const NOTICE_DOT = 'mt-1.5 inline-block w-2 h-2 rounded-full shrink-0';

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

/**
 * The disclosure that un-clamps a notice's detail.
 *
 * It is a checkbox, not a button, and that is deliberate rather than sloppy: the
 * damped notice is contractually control-FREE — `EstopBanner.test.tsx` asserts
 * `queryByRole('button')` is null while the base is damped, because the one
 * thing this page must never grow is a control that re-arms the robot for the
 * operator. A disclosure rendered as a `<button>` would break that guarantee for
 * a piece of pure prose. A labelled checkbox is still focusable, still operable
 * with the keyboard, still announced with its expanded state, and carries no
 * promise of doing anything to the robot.
 *
 * The label text does NOT change with the state — the accessible name has to be
 * stable, and `aria-expanded` already carries the state.
 *
 * `label` names WHICH condition it belongs to. With three notices up at once —
 * the normal case, not the edge case — tabbing through the stack otherwise
 * announces "Details, checkbox, collapsed" three times with nothing to tell them
 * apart: `aria-controls` points at the detail span, but no screen reader reads
 * the controlled element's context on focus.
 */
function DisclosureToggle({
  expanded,
  onChange,
  controls,
  label,
}: {
  expanded: boolean;
  onChange: (next: boolean) => void;
  controls: string;
  label?: string;
}) {
  return (
    <label
      className={cn(
        'shrink-0 ml-auto sm:ml-0 inline-flex items-center gap-1 cursor-pointer select-none',
        'rounded-brand px-2 py-1 text-[11px] text-theme-tertiary hover:text-theme-secondary',
        'transition-colors focus-within:ring-2 focus-within:ring-cobalt-500/40',
        'pointer-coarse:min-h-11 pointer-coarse:px-3'
      )}
    >
      <input
        type="checkbox"
        className="sr-only"
        checked={expanded}
        aria-expanded={expanded}
        aria-controls={controls}
        aria-label={label}
        onChange={(event) => onChange(event.target.checked)}
      />
      Details
      <ChevronIcon className={cn('w-3 h-3 transition-transform', expanded && 'rotate-180')} />
    </label>
  );
}

interface NoticeProps {
  testId: string;
  /** `data-*` evidence attributes the e2e suite and the drawer read. */
  dataAttrs?: Record<string, string>;
  role: 'status' | 'alert';
  ariaLive?: 'polite';
  /** Dot colour, e.g. `bg-amber-500`. */
  dot: string;
  /** Extra classes for the card itself (border, background). */
  card?: string;
  /** Title colour. */
  accent?: string;
  title?: ReactNode;
  titleTestId?: string;
  titleClassName?: string;
  detail: ReactNode;
  detailTestId?: string;
  detailClassName?: string;
  /** Always visible, never behind the disclosure. */
  action?: ReactNode;
  /**
   * Alarm-grade: render the whole detail and omit the disclosure entirely.
   * "It may still be moving — use the hardware E-Stop" is an instruction, not an
   * explanation, and an instruction is never one click away.
   */
  alwaysExpanded?: boolean;
}

/**
 * One condition, one line.
 *
 * The detail span ALWAYS renders its full text; collapsing is `line-clamp-1` and
 * nothing else. Conditionally rendering the prose would make the words on this
 * page depend on a UI state — an operator reading a screenshot, a screen reader
 * walking the DOM and `EstopBanner.test.tsx` all have to see the same sentences,
 * so the clamp is a paint-time decision, never a render-time one.
 */
function Notice({
  testId,
  dataAttrs,
  role,
  ariaLive,
  dot,
  card,
  accent,
  title,
  titleTestId,
  titleClassName,
  detail,
  detailTestId,
  detailClassName,
  action,
  alwaysExpanded = false,
}: NoticeProps) {
  const [expanded, setExpanded] = useState(false);
  const detailId = useId();
  const open = alwaysExpanded || expanded;

  return (
    <div
      data-testid={testId}
      {...dataAttrs}
      role={role}
      aria-live={ariaLive}
      className={cn(NOTICE_ROW, card)}
    >
      <span className={cn(NOTICE_DOT, dot)} />
      {title !== undefined && (
        <span
          data-testid={titleTestId}
          // `shrink-0` so the headline is never the thing that gets squeezed;
          // `max-w-full` so on a 390px phone it wraps inside the card instead of
          // pushing the row into a horizontal scroll.
          className={cn(
            'text-sm font-semibold leading-5 shrink-0 max-w-full',
            accent,
            titleClassName
          )}
        >
          {title}
        </span>
      )}
      <span
        id={detailId}
        data-testid={detailTestId}
        className={cn(
          'card-meta leading-5 min-w-0 basis-full sm:basis-0 sm:flex-1',
          detailClassName,
          !open && 'line-clamp-1'
        )}
      >
        {detail}
      </span>
      {action}
      {!alwaysExpanded && (
        <DisclosureToggle
          expanded={expanded}
          onChange={setExpanded}
          controls={detailId}
          label={typeof title === 'string' ? `Details — ${title}` : undefined}
        />
      )}
    </div>
  );
}

/**
 * What the operator needs after an E-Stop: the base is damped and every
 * locomotion block will be accepted and quietly do nothing until it stands up
 * again. Deliberately *not* a button — re-arming the robot is a human action
 * sent as a command, never something this page does on its own.
 *
 * The clamp shows the actionable half, so the sentence order is: what happens to
 * your blocks and what to send instead, THEN the mechanism.
 */
function DampedNotice({ fsmId }: { fsmId: number | null }) {
  return (
    <Notice
      testId="agent-damped-banner"
      dataAttrs={{ 'data-fsm-id': String(fsmId ?? '') }}
      role="status"
      dot="bg-amber-500"
      card="border-amber-500/50 bg-amber-500/5"
      accent="text-amber-600 dark:text-amber-400"
      title="Base damped — the robot cannot move"
      detail={
        <>
          Walk, turn and go-to blocks are accepted and do nothing — send a{' '}
          <span className="text-theme-secondary">posture</span> block with pose{' '}
          <span className="text-theme-secondary">stand</span>. The base sits in a
          non-locomoting FSM
          {fsmId === null ? '' : ` (FSM ${fsmId})`}; clearing the E-Stop latch does not re-arm
          the base.
        </>
      }
      detailTestId="agent-damped-detail"
    />
  );
}

/**
 * The robot exists and could not be asked what it is doing (server 502
 * `AGENT_STATE_UNAVAILABLE`): offline, timed out, refused by its personal-data
 * gate, or it answered with something that was not a state.
 *
 * This notice exists because the alternative is worse than an empty page: with
 * no state, `enabled` and `estopActive` fall back to `false`, and the console
 * then tells an operator "Agent Mode off, E-Stop clear" about a robot nobody
 * can reach. So it says the one true thing instead — we do not know — and says
 * it in the ordinary amber the damped and recovered notices use.
 *
 * Amber and `role="status"`, deliberately not red and not `alert`: an offline
 * robot is a normal, frequent condition, and an alarm that fires every time
 * someone opens the page while the agent is down is an alarm nobody reads by
 * the time it matters. The severity lives in the words.
 *
 * Those words are ordered so the clamp shows the instruction: this is not
 * "E-Stop clear", and here is what to do about it. The evidence (which read
 * failed, and what else on the page is now a memory) follows behind it.
 */
function UnknownStateNotice({ reason }: { reason: string | null }) {
  return (
    <Notice
      testId="agent-state-unknown-banner"
      role="status"
      ariaLive="polite"
      dot="bg-amber-500"
      card="border-amber-500/50 bg-amber-500/5"
      accent="text-amber-600 dark:text-amber-400"
      title="Robot not reachable — E-Stop state UNKNOWN"
      titleTestId="agent-state-unknown-title"
      detail={
        <>
          This is <span className="text-amber-600 dark:text-amber-400">not</span> &ldquo;E-Stop
          clear&rdquo; — use the hardware E-Stop if it has to stop; STOPP here still tries, and
          reports what it gets back. This console could not ask the robot for its state
          {reason ? `: ${reason}` : '.'} Whether Agent Mode is on, what it is doing and whether
          its E-Stop is latched are all unknown. Everything else on this page is the last thing
          this console heard, not what the robot is doing now.
        </>
      }
      detailTestId="agent-state-unknown-detail"
    />
  );
}

/** Local date-time, or the raw ISO string when it cannot be parsed. */
function formatBootTime(at: string): string {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? at : date.toLocaleString();
}

/**
 * The robot came back from a restart still holding its E-Stop latch, or from a
 * shutdown that was never clean. Both are states an operator has to *see*: a
 * robot that silently refuses to move is the thing that gets its state file
 * deleted by whoever meets it first — which throws away the latch, the battery,
 * the pose and the task queue at once, and is a far worse outcome than the bug
 * durable safety state exists to prevent.
 *
 * The button is therefore not optional polish. It is the supported way out, and
 * it does two things at once: it clears the latch (through the normal reset the
 * SafetyMonitor may still refuse) and it acknowledges the recovery, which is
 * what lets the robot act on its own again.
 *
 * Which is also why the detail leads with "do not delete the state file": that
 * warning is the one sentence the clamp has room for, and it is the one that
 * prevents the damage.
 */
function RecoveredNotice({
  recovered,
  onReset,
}: {
  recovered: AgentRecoveryState;
  onReset: () => void;
}) {
  const title = recovered.estopLatched
    ? 'Still E-Stopped from before the restart'
    : 'Recovered from an unclean shutdown';

  return (
    <Notice
      testId="agent-recovered-banner"
      dataAttrs={{
        'data-from-crash': String(recovered.fromCrash),
        'data-estop-latched': String(recovered.estopLatched),
      }}
      role="alert"
      dot="bg-amber-500"
      card="border-amber-500/50 bg-amber-500/5"
      accent="text-amber-600 dark:text-amber-400"
      title={title}
      titleTestId="agent-recovered-title"
      detail={
        <>
          Clear it here — do not delete the robot&apos;s state file.{' '}
          {recovered.estopLatched
            ? 'The robot read its E-Stop back off disk when it came up and is refusing ' +
              'to move — deliberately. '
            : 'The robot agent did not shut down cleanly, so it will not act on its own ' +
              'until someone has seen this. '}
          {recovered.fromCrash
            ? 'The previous session ended without a clean shutdown (crash, kill or power loss). '
            : 'The previous session ended cleanly. '}
          Booted {formatBootTime(recovered.at)}.
        </>
      }
      detailTestId="agent-recovered-detail"
      action={
        <button
          type="button"
          data-testid="agent-recovered-reset"
          onClick={onReset}
          className={SAFETY_BUTTON}
        >
          {recovered.estopLatched ? 'Reset E-Stop & acknowledge' : 'Acknowledge'}
        </button>
      }
    />
  );
}

/**
 * The latch itself. The five statuses are visually distinct on purpose — an
 * unverified stop must not look like a finished one, and an unknown one must not
 * look like either.
 */
function EstopNotice({
  status,
  error,
  stateUnknown,
  onReset,
}: {
  status: AgentEstopStatus;
  error: string | null;
  stateUnknown: boolean;
  onReset: () => void;
}) {
  const copy = copyFor(status, error, stateUnknown);
  const unverified =
    stateUnknown || status === 'requesting' || status === 'unconfirmed' || status === 'failed';
  // A stop that is not confirmed on the hardware is an alarm, not a status.
  const alarm = status === 'failed' || status === 'unconfirmed';

  return (
    <Notice
      testId="agent-estop-banner"
      dataAttrs={{ 'data-estop-status': status }}
      role={alarm ? 'alert' : 'status'}
      dot={cn(copy.dot, status !== 'acknowledged' && 'animate-pulse')}
      card={cn(copy.border, alarm && 'bg-red-500/10')}
      accent={copy.accent}
      title={copy.title}
      titleTestId="agent-estop-title"
      titleClassName={cn(alarm && 'uppercase')}
      detail={copy.detail}
      detailTestId="agent-estop-detail"
      detailClassName={cn(unverified && copy.accent)}
      // An unconfirmed stop is the one state where the tail is an instruction.
      alwaysExpanded={alarm}
      action={
        <button
          type="button"
          data-testid="agent-estop-reset"
          onClick={onReset}
          className={SAFETY_BUTTON}
        >
          Reset E-Stop
        </button>
      }
    />
  );
}

/**
 * The console's own last request failed — a 500, a dropped connection, a refused
 * write. Last line and lowest severity by construction: it says something about
 * this browser tab, not about the robot's latch or its base, and giving it the
 * same weight as "the base cannot walk" is exactly how a warning colour stops
 * meaning anything.
 *
 * Which is why it is NOT a red-dotted, red-bordered card. `levelFor` grades it 1
 * for exactly this reason, and rendering it in the same red as the E-Stop alarm
 * two rows above — in the same stack, in the same shape — put a claim about an
 * HTTP response where an operator reads claims about the robot. The dot and the
 * card are neutral; the message itself keeps the red so it is still obviously a
 * failure, and the title says whose.
 */
function ErrorNotice({ error, onDismiss }: { error: string; onDismiss?: () => void }) {
  return (
    <Notice
      testId="agent-error-banner"
      role="status"
      dot="bg-theme-tertiary"
      accent="text-theme-secondary"
      title="Last request failed"
      detail={<span className="text-red-600 dark:text-red-400">{error}</span>}
      action={
        onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss error"
            className="ml-auto shrink-0 card-meta px-2 py-1 hover:text-theme-primary transition-colors"
          >
            Dismiss
          </button>
        ) : undefined
      }
    />
  );
}

/**
 * Rendered while the robot cannot be reached, the local latch is set, the base
 * is damped, this boot inherited something unresolved, or the last request
 * failed. Nothing true is ever capped, summarised or folded into "+n more" —
 * simultaneous conditions are the normal case, not the edge case, and an
 * operator who sees one notice must be able to trust that it is the only one.
 *
 * Order comes from `CONDITION_ORDER`, the same sequence the details drawer's
 * checklist and the rail dot read, so the stack cannot drift out of step with
 * them: state-unknown first because it qualifies everything under it (while the
 * robot is silent, "latched", "damped" and "recovered" are memories, not
 * readings), the console's own error last. The damped notice deliberately
 * outlives a Reset E-Stop — clearing the latch is not what makes the robot able
 * to walk again.
 */
export const EstopBanner = memo(function EstopBanner({
  onReset,
  error,
  onDismissError,
  className,
}: EstopBannerProps) {
  const estopActive = useAgentModeStore(selectEstopActive);
  const status = useAgentModeStore(selectEstopStatus);
  const estopError = useAgentModeStore(selectEstopError);
  const damped = useAgentModeStore(selectDamped);
  const fsmId = useAgentModeStore(selectFsmId);
  const recovered = useAgentModeStore(selectRecovered);
  const stateUnknown = useAgentModeStore(selectStateUnknown);
  const unavailableReason = useAgentModeStore(selectStateUnavailableReason);

  // Built by key, rendered by CONDITION_ORDER: adding a notice cannot change the
  // sequence the operator has learned, and forgetting one cannot hide it either.
  const notices: Partial<Record<ConditionKey, ReactNode>> = {};
  if (stateUnknown) notices.stateUnknown = <UnknownStateNotice reason={unavailableReason} />;
  if (estopActive) {
    notices.estop = (
      <EstopNotice
        status={status}
        error={estopError}
        stateUnknown={stateUnknown}
        onReset={onReset}
      />
    );
  }
  if (recovered) notices.recovered = <RecoveredNotice recovered={recovered} onReset={onReset} />;
  if (damped) notices.damped = <DampedNotice fsmId={fsmId} />;
  if (error) notices.error = <ErrorNotice error={error} onDismiss={onDismissError} />;

  const active = CONDITION_ORDER.filter((key) => notices[key] !== undefined);
  if (active.length === 0) return null;

  return (
    <div className={cn('space-y-2', className)}>
      {active.map((key) => (
        // A Fragment leaves no DOM node behind, so `space-y-2` still applies to
        // the notices themselves.
        <Fragment key={key}>{notices[key]}</Fragment>
      ))}
    </div>
  );
});
