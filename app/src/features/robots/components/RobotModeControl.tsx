/**
 * @file RobotModeControl.tsx
 * @description Switch the robot between Limp, Stand up and Balance without the
 *              Unitree remote (TASK-398). Shows the MEASURED mode, three
 *              buttons each behind a confirmation, and — as visible text, not
 *              a tooltip — why a button is disabled. Desktop only: there are no
 *              mode buttons inside the headset (a confirmation needs a mouse
 *              and a second person watching the robot).
 * @feature robots
 */

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/shared/components/ui/Button';
import { ConfirmDialog } from '@/shared/components/ui/ConfirmDialog';
import { cn } from '@/shared/utils/cn';
import { useRobotBaseMode, type UseRobotBaseModeReturn } from '../hooks/useRobotBaseMode';
import type { BaseModeCommand, BaseModeName, BaseModeStatus } from '../api/baseModeApi';

/** The sidecar's default `G1_LOCO_STAND_SETTLE_S`; the sidecar enforces the real one. */
export const STAND_SETTLE_S = 2;

const MODE_LABELS: Record<BaseModeName, string> = {
  limp: 'Limp',
  stand: 'Stand (locked)',
  balance: 'Balance',
  zero_torque: 'Zero torque',
  other: 'Other',
  unknown: 'Unknown',
};

const BUTTONS: ReadonlyArray<{ mode: BaseModeCommand; label: string; title: string; text: string }> = [
  {
    mode: 'stand',
    label: 'Stand up',
    title: 'Stand the robot up?',
    text: 'Legs stiffen and lock in a standing pose. Feet flat on the floor, gantry attached with a '
      + 'little slack, nobody within reach.',
  },
  {
    mode: 'balance',
    label: 'Balance',
    title: 'Hand the robot to the balance controller?',
    text: "Unitree's balance controller takes over; the robot may shift its weight. Arms stay under "
      + 'Unitree control until someone takes control and squeezes the grip.',
  },
  {
    mode: 'limp',
    label: 'Limp',
    title: 'Make the robot go limp?',
    text: 'The robot goes limp and sags into the gantry. Make sure the gantry is carrying it.',
  },
];

/** The readout label for a measured mode, with the id for `other`. */
export function modeLabel(mode: BaseModeName, fsmId: number | null): string {
  return mode === 'other' && fsmId !== null ? `Other (${fsmId})` : MODE_LABELS[mode];
}

export interface ModeReasonContext {
  status: BaseModeStatus | null;
  /**
   * This console holds no bound control lease. Mode changes always need one —
   * the server refuses a request without it — so this is set whether or not
   * leases are advertised; see `leasesOff` for the reason text.
   */
  needsControl: boolean;
  /** Control leases are off or unknown on this server, so none can be taken. */
  leasesOff?: boolean;
  /** The arm_sdk path is engaged (armed or ramping). */
  armsEngaged: boolean;
  /** A request from this console is in flight. */
  pending: boolean;
  /** Seconds the robot has been measured in stand, or null. */
  standHeldS: number | null;
}

/**
 * Why `mode` cannot be requested right now — the FIRST reason that applies, in
 * the spec's order — or null when it can. Limp is exempt from the unknown-mode,
 * E-stop, arms and in-flight reasons: it is the safe direction, the sidecar
 * always accepts it, and it preempts a Stand up or Balance still waiting for
 * the robot to confirm — the moment the operator most needs it.
 */
export function modeDisabledReason(mode: BaseModeCommand, ctx: ModeReasonContext): string | null {
  const status = ctx.status;
  const gate = status?.capability.gate;
  if (!status || (gate !== 'fsm' && gate !== 'full')) {
    return "Mode control is off on this robot's sidecar.";
  }
  const base = status.base;
  const measured = base?.mode ?? 'unknown';
  if (measured === 'unknown' && mode !== 'limp') {
    return `The robot mode is unknown${base?.error ? ` — ${base.error}` : ''}.`;
  }
  if (ctx.needsControl) {
    return ctx.leasesOff
      ? 'Mode changes need a control lease, and control leases are off on this server.'
      : 'Take control first.';
  }
  if (mode !== 'limp' && (status.estopLatched || status.sidecarEstopLatched)) {
    return 'Reset the E-stop first.';
  }
  if (mode !== 'limp' && (ctx.armsEngaged || status.armed)) {
    return 'Release the grip; arms are engaged.';
  }
  if (mode === 'stand' && measured !== 'limp') return 'Stand up needs Limp.';
  if (mode === 'balance') {
    if (measured !== 'stand') return 'Balance needs Stand.';
    const held = ctx.standHeldS ?? 0;
    if (held < STAND_SETTLE_S) {
      return `Balance needs Stand — wait ${Math.max(0.1, STAND_SETTLE_S - held).toFixed(1)} s more.`;
    }
  }
  if (mode !== 'limp' && (ctx.pending || status.inFlight)) return 'A change is in progress.';
  return null;
}

export interface RobotModeControlProps {
  robotId: string;
  /** The page's control lease. `grant()` is read at click time only. */
  lease: {
    enabled: boolean;
    state: string;
    grant(): { leaseId: string; generation: number } | null;
  };
  /** The arms are engaged, as the page knows it live (VR arm frame). */
  armsEngaged?: boolean;
  /** Inject a hook result (tests); otherwise polls at 1 Hz. */
  baseMode?: UseRobotBaseModeReturn;
  className?: string;
}

export function RobotModeControl({ robotId, lease, armsEngaged = false, baseMode, className }: RobotModeControlProps) {
  const own = useRobotBaseMode(robotId, { enabled: baseMode === undefined });
  const bm = baseMode ?? own;
  const [confirming, setConfirming] = useState<BaseModeCommand | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const limpRef = useRef<HTMLButtonElement>(null);

  // Re-render for the "measured N s ago" age and the settle countdown.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);

  const result = bm.lastResult;
  const unconfirmed = result !== null && !result.ok && result.status === 504;
  // An unconfirmed change: put the operator on Limp.
  useEffect(() => {
    if (unconfirmed) limpRef.current?.focus();
  }, [unconfirmed]);

  const base = bm.status?.base ?? null;
  const mode: BaseModeName = base?.mode ?? 'unknown';
  const sinceRead = bm.readAt === null ? null : Math.max(0, now - bm.readAt) / 1000;
  const age = base?.ageS !== null && base?.ageS !== undefined && sinceRead !== null ? base.ageS + sinceRead : null;
  const standHeldS = mode === 'stand' && bm.standSince !== null ? Math.max(0, now - bm.standSince) / 1000 : null;
  const ctx: ModeReasonContext = {
    status: bm.status,
    // Always: the server refuses a mode change without a lease, so a console
    // that cannot present one must not offer the buttons (TASK-398 AC).
    needsControl: !lease.enabled || lease.state !== 'bound',
    leasesOff: !lease.enabled,
    armsEngaged,
    pending: bm.pending !== null,
    standHeldS,
  };
  const idsVerified = bm.status?.capability.idsVerified ?? false;
  const tone = mode === 'balance' ? 'text-signal-measured'
    : mode === 'unknown' ? 'text-signal-stopped'
      : mode === 'limp' ? 'text-signal-unknown'
        : 'text-ink-primary';
  const pendingButton = BUTTONS.find((b) => b.mode === confirming) ?? null;

  const reasons = BUTTONS
    .map((b) => ({ b, reason: modeDisabledReason(b.mode, ctx) }))
    .filter((r): r is { b: (typeof BUTTONS)[number]; reason: string } => r.reason !== null);

  return (
    <div className={cn('min-w-0 space-y-1.5', className)} data-testid="robot-mode-control">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-sm" title={base?.fsmId !== null && base?.fsmId !== undefined ? `FSM ${base.fsmId}` : 'No FSM reading'}>
          <span className="text-ink-secondary">Mode: </span>
          <span className={cn('font-semibold', tone)} data-testid="robot-mode-readout">
            {modeLabel(mode, base?.fsmId ?? null)}
          </span>
          {base?.fsmId !== null && base?.fsmId !== undefined && (
            <span className="text-ink-tertiary"> · FSM {base.fsmId}</span>
          )}
          {age !== null && (
            <span className="text-xs text-ink-tertiary"> · measured {age.toFixed(1)} s ago</span>
          )}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {BUTTONS.map((b) => (
            <Button
              key={b.mode}
              ref={b.mode === 'limp' ? limpRef : undefined}
              size="sm"
              variant={b.mode === 'limp' ? 'secondary' : 'outline'}
              disabled={modeDisabledReason(b.mode, ctx) !== null}
              data-testid={`robot-mode-${b.mode}`}
              onClick={() => setConfirming(b.mode)}
            >
              {bm.pending === b.mode ? `${b.label}…` : b.label}
            </Button>
          ))}
        </div>
      </div>

      {mode === 'unknown' && base?.error && (
        <p className="text-xs text-signal-stopped">{base.error}</p>
      )}
      {!idsVerified && bm.status?.capability.gate === 'fsm' && (
        <p className="text-xs text-ink-tertiary">
          Stand-up FSM {bm.status.capability.ids?.stand ?? 4} is not yet verified on this robot — watch the first
          Stand up closely.
        </p>
      )}
      {reasons.length > 0 && (
        <ul className="space-y-0.5 text-xs text-ink-secondary" data-testid="robot-mode-reasons">
          {reasons.map(({ b, reason }) => (
            <li key={b.mode}>
              <span className="font-medium">{b.label}:</span> {reason}
            </li>
          ))}
        </ul>
      )}
      {result && !result.ok && (
        <p
          role="alert"
          data-testid="robot-mode-error"
          className={cn('text-xs', unconfirmed ? 'font-semibold text-signal-stopped' : 'text-signal-unknown')}
        >
          {unconfirmed
            ? `Not confirmed — the robot reports ${modeLabel(result.measured?.mode ?? 'unknown', result.measured?.fsmId ?? null)}. Use Limp if in doubt.`
            : `${result.code}: ${result.error}`}
        </p>
      )}

      <ConfirmDialog
        isOpen={pendingButton !== null}
        onClose={() => setConfirming(null)}
        onConfirm={async () => {
          const target = pendingButton;
          setConfirming(null);
          if (target) await bm.request(target.mode, lease.grant());
        }}
        title={pendingButton?.title ?? ''}
        description={pendingButton?.text}
        confirmLabel={pendingButton?.label}
        tone={pendingButton?.mode === 'limp' ? 'danger' : 'default'}
        testId="robot-mode-confirm"
      />
    </div>
  );
}
