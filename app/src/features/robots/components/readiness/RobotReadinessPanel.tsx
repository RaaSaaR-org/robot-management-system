/**
 * @file RobotReadinessPanel.tsx
 * @description Robot readiness (TASK-411): ONE bold line on top that says why
 *              the arms are not following (D1), the checklist that explains it
 *              (link, bridge, sidecar, agent, robot mode, arms, each hand,
 *              camera, control, Quest — with Connect / Open on headset in the
 *              full variant, TASK-412), and the robot-side buttons — Start
 *              (always read-only, D2), a separate confirmed and lease-gated
 *              "Switch to arm control", Stop (which offers Limp first but never
 *              limps on its own, D3), Adopt / Leave for a foreign process (D4),
 *              and the logs. Where arm control or Limp first is blocked only by
 *              the missing lease, it offers "Take control" when the page can
 *              take it (TASK-419 D3). Nothing here moves the robot; the only motion-
 *              adjacent step is Limp, through the existing confirmed base-mode
 *              route.
 *
 *              Variants: `full` (robot detail Teleop tab), `compact` (inside the
 *              VR launcher — the reason, the failing rows and Start, D5),
 *              `line` (the VR window header — the reason only) and `rows`
 *              (TASK-427: the checklist rows alone, for a Set up step's
 *              Details; `rows` narrows any variant to those row ids).
 *              `ReadinessActions` renders the robot-side buttons (and their
 *              confirmations and logs) on their own, so a Set up step can host
 *              just the ones it is about. TASK-430: "Restart robot side" for a
 *              robot side that runs stale code, behind the Stop confirm — only
 *              where a host lists it; the full panel keeps Stop and Start.
 *              TASK-437: the arm switch goes out only with control held. A
 *              lease that ended while its confirm was open is taken again on
 *              the confirm; when that fails, nothing is sent.
 * @feature robots
 */

import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Activity, Hand, Lock, Play, RotateCw, ScrollText, Square, Wifi } from 'lucide-react';
import { Button } from '@/shared/components/ui/Button';
import { ConfirmDialog } from '@/shared/components/ui/ConfirmDialog';
import { Panel } from '@/shared/components/ui/Panel';
import { cn } from '@/shared/utils/cn';
import { toneTag, type BaseTone } from '@/shared/components/ui/styles';
import { useRobotReadiness, type UseRobotReadinessReturn } from '../../hooks/useRobotReadiness';
import { useRobotBaseMode } from '../../hooks/useRobotBaseMode';
import { baseModeApi as defaultBaseModeApi, type BaseModeApi } from '../../api/baseModeApi';
import { questPagePort, type BringupProc, type ReadinessApi, type ReadinessSeverity, type RobotReadiness } from '../../api/readinessApi';
import { QuestControls, type QuestControlsApi } from './QuestControls';
import { ReadinessRow } from './ReadinessRow';
import { BringupLogsDrawer } from './BringupLogsDrawer';
import { isFailing, readinessRows, reasonRow, robotSideActions, type RowId } from './readinessRows';

const SEVERITY_TONE: Record<ReadinessSeverity, BaseTone> = {
  block: 'danger',
  warn: 'warning',
  ok: 'success',
};

/** How long Limp first waits for the robot to MEASURE limp before giving up. */
export const LIMP_WAIT_MS = 15_000;
const LIMP_POLL_MS = 500;

export interface ReadinessLease {
  enabled: boolean;
  state: string;
  grant(): { leaseId: string; generation: number } | null;
  /**
   * Take control from the panel (TASK-419 D3): connect what the lease needs and
   * take it; resolves true once bound. Without it the panel can only say
   * "Take control first."
   */
  take?: () => Promise<boolean>;
}

/**
 * What a Stop does, said the same way in the Stop and the Restart confirm
 * (TASK-430): the supervisor disarms the arms before it stops anything.
 */
export const STOP_SAFETY = "The arms are disarmed first, then the agent, sidecar and bridge stop. Stopping does not change the robot's mode.";
export const RESTART_WORDS = `${STOP_SAFETY} Then they start again on the current code, read-only: switch to arm control again afterwards.`;

/** The modes a stop dialog offers Limp first for: the robot is holding itself up. */
function upright(mode: string | null | undefined): boolean {
  return mode === 'stand' || mode === 'balance';
}

/** The supervisor reports its profile as a path; the file's name is the profile. */
export function profileName(profile: string): string {
  return (profile.split('/').pop() ?? profile).replace(/\.ya?ml$/, '');
}

export function measuredMode(r: RobotReadiness | null): string | null {
  return r?.agent.readiness?.base?.mode ?? r?.bringup?.lastBase?.mode ?? null;
}

// ============================================================================
// REASON LINE
// ============================================================================

export interface ReadinessReasonLineProps {
  readiness: RobotReadiness | null;
  stale?: boolean;
  readError?: string | null;
  size?: 'lg' | 'sm';
  /**
   * TASK-417: what this page still has to do while the robot side is ready —
   * the VR window before control is taken says "Take control, then Enter VR"
   * rather than a green "Ready" next to a greyed Enter VR. Shown amber, and
   * only when the reason is `ok`; a blocking reason always wins.
   */
  pendingStep?: string | null;
  className?: string;
}

export function ReadinessReasonLine({
  readiness, stale = false, readError = null, size = 'lg', pendingStep = null, className,
}: ReadinessReasonLineProps) {
  if (!readiness) {
    return (
      <p className={cn('text-[13px] text-ink-secondary', className)} data-testid="readiness-reason" data-severity="unknown">
        {readError ? `Readiness not available: ${readError}` : 'Reading the robot’s readiness…'}
      </p>
    );
  }
  const { reason } = readiness;
  const step = reason.severity === 'ok' && pendingStep ? pendingStep : null;
  return (
    <div
      className={cn(
        'flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-control border px-3 py-2',
        toneTag[step ? 'warning' : SEVERITY_TONE[reason.severity]],
        className,
      )}
      data-testid="readiness-reason"
      data-severity={step ? 'warn' : reason.severity}
      data-code={step ? 'page_step' : reason.code}
      role="status"
    >
      <span className={cn('font-semibold', size === 'lg' ? 'text-[17px] leading-snug' : 'text-[13px]')}>{step ?? reason.text}</span>
      <span className="text-[11px] uppercase tracking-wide opacity-75">
        {reason.source === 'server' ? 'robot side' : 'robot agent'}
        {stale ? ' · stale' : ''}
      </span>
    </div>
  );
}

// ============================================================================
// PANEL
// ============================================================================

export interface RobotReadinessPanelProps {
  robotId: string;
  variant?: 'full' | 'compact' | 'line' | 'rows';
  /** Only these rows (TASK-427: a Set up step's Details). */
  rows?: RowId[];
  /** The page's control lease; arm control and Limp first need it bound. */
  lease?: ReadinessLease | null;
  /** Inject a hook result (tests); otherwise reads live. */
  readiness?: UseRobotReadinessReturn;
  baseModeApi?: BaseModeApi;
  logsApi?: Pick<ReadinessApi, 'getBringupLogs' | 'streamBringupLogs'>;
  limpWaitMs?: number;
  /** The Quest buttons' calls (tests). */
  questApi?: QuestControlsApi;
  /** `line` only (TASK-417): the page's own next step while the robot side is ready. */
  pendingStep?: string | null;
  className?: string;
}

export function RobotReadinessPanel(props: RobotReadinessPanelProps) {
  const own = useRobotReadiness(props.robotId, { enabled: props.readiness === undefined });
  const ready = props.readiness ?? own;
  if (props.variant === 'line') {
    return (
      <ReadinessReasonLine
        readiness={ready.readiness}
        stale={ready.stale}
        readError={ready.readError}
        size="sm"
        pendingStep={props.pendingStep}
        className={props.className}
      />
    );
  }
  return <ReadinessBody {...props} ready={ready} />;
}

/** What a robot-side action button set needs. */
export interface ReadinessActionsOptions {
  robotId: string;
  lease?: ReadinessLease | null;
  ready: UseRobotReadinessReturn;
  baseModeApi?: BaseModeApi;
  logsApi?: Pick<ReadinessApi, 'getBringupLogs' | 'streamBringupLogs'>;
  limpWaitMs?: number;
}

/** The robot-side buttons a host may show (TASK-427). `restart` shows only where `only` lists it (TASK-430). */
export type ReadinessActionId = 'start' | 'restart' | 'arm' | 'read_only' | 'stop' | 'logs';

export interface ReadinessButtonsOptions {
  compact?: boolean;
  /** Only these buttons (default: all the variant shows). */
  only?: ReadinessActionId[];
  /**
   * The host's one lit action (a Set up step that is open): the next button —
   * Start, Restart, Take control, or Switch to arm control once control is held — gets
   * the primary fill and every other one is secondary. Unset: the panel's own
   * look.
   */
  lit?: boolean;
}

/**
 * The robot-side actions' state, handlers, confirmations and logs drawer, so
 * the full panel and a Set up step draw the same buttons with the same rules.
 */
function useReadinessActions({
  robotId,
  lease = null,
  ready,
  baseModeApi = defaultBaseModeApi,
  logsApi,
  limpWaitMs = LIMP_WAIT_MS,
}: ReadinessActionsOptions) {
  const { readiness, actions, pending, lastError } = ready;
  const baseMode = useRobotBaseMode(robotId, { api: baseModeApi, enabled: false });
  const [confirm, setConfirm] = useState<'arm' | 'read_only' | 'stop' | 'restart' | null>(null);
  // The stop dialog keeps its words while it closes.
  const stopKind = useRef<'stop' | 'restart'>('stop');
  if (confirm === 'stop' || confirm === 'restart') stopKind.current = confirm;
  const restartDialog = stopKind.current === 'restart';
  const [limping, setLimping] = useState(false);
  const [limpError, setLimpError] = useState<string | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);
  const [taking, setTaking] = useState(false);
  const [takeError, setTakeError] = useState<string | null>(null);

  const bringup = readiness?.bringup ?? null;
  const overall = bringup?.overall ?? null;
  const busy = pending !== null || limping;
  const side = robotSideActions(readiness);
  const canStart = side.start;
  const canStop = side.stop;
  // A restart in flight keeps its button (loading) and hides Start and Stop.
  const restarting = pending?.action === 'restart';
  const sidecarStep = bringup?.steps.find((s) => s.id === 'sidecar') ?? null;
  const sidecarUp = sidecarStep?.state === 'ok' && (overall === 'ready' || overall === 'degraded');
  const showArmSwitch = bringup?.sidecarMode === 'read_only' && sidecarUp;
  const showReadOnlySwitch = bringup?.sidecarMode === 'arm_sdk' && sidecarUp;
  const leaseBound = lease !== null && lease.state === 'bound';
  const armBlockedReason = leaseBound
    ? null
    : lease && !lease.enabled
      ? 'Arm control needs a control lease, and control leases are off on this server.'
      : 'Take control first.';
  const limpBlockedReason = leaseBound
    ? null
    : lease && !lease.enabled
      ? 'Limp needs a control lease, and control leases are off on this server.'
      : 'Take control first.';
  // A blocked button that names a missing action offers it (TASK-419 D3).
  const take = !leaseBound && lease?.enabled && lease.take ? lease.take : null;
  const takeControl = async (then?: () => void) => {
    if (!take) return;
    setTaking(true);
    setTakeError(null);
    try {
      const ok = await take().catch(() => false);
      if (!ok) {
        setTakeError('Could not take control. See the control bar above for why.');
        return;
      }
      then?.();
    } finally {
      setTaking(false);
    }
  };
  /**
   * Switch to arm control, with control held when the request goes out
   * (TASK-437). The lease can end while the confirm is open: a tab that stops
   * running for a few seconds misses its 1 s renewals, the robot expires the
   * 5 s lease, and the server then refuses the switch (409 `lease_required`).
   * The confirm is the explicit press taking control needs, so it takes it
   * again first; when that fails it sends nothing and says so.
   */
  const switchToArmControl = async () => {
    setConfirm(null);
    let grant = lease?.grant() ?? null;
    if (!grant && lease?.enabled) {
      const retake = lease.take;
      if (!retake) {
        setTakeError('Control ran out before the switch, so arm control was not switched on. Take control, then switch.');
        return;
      }
      setTaking(true);
      setTakeError(null);
      try {
        grant = (await retake().catch(() => false)) ? lease.grant() : null;
      } finally {
        setTaking(false);
      }
      if (!grant) {
        setTakeError('Control ran out before the switch and could not be taken again, so arm control was not switched on.');
        return;
      }
    }
    await actions.switchMode('arm_sdk', grant);
  };
  const mode = measuredMode(readiness);
  const offerLimp = upright(mode);
  const linkStep = bringup?.steps.find((s) => s.id === 'link') ?? null;
  const lanDown = linkStep?.state === 'failed' && linkStep.code === 'no_host_ip';
  const procs: BringupProc[] = bringup?.robot === 'sim' ? ['sim', 'bridge', 'sidecar', 'agent'] : ['bridge', 'sidecar', 'agent'];

  const doStop = async () => {
    setConfirm(null);
    await actions.stop();
  };
  const doRestart = async () => {
    setConfirm(null);
    await actions.restart();
  };

  const limpThenStop = async () => {
    const restart = confirm === 'restart';
    const grant = lease?.grant() ?? null;
    if (!grant) {
      setLimpError('Take control first.');
      return;
    }
    setLimping(true);
    setLimpError(null);
    try {
      const result = await baseMode.request('limp', grant);
      if (!result.ok) {
        setLimpError(`Limp was refused: ${result.error}`);
        return;
      }
      const deadline = Date.now() + limpWaitMs;
      for (;;) {
        const status = await baseModeApi.getBaseMode(robotId).catch(() => null);
        if (status?.base?.mode === 'limp') break;
        if (Date.now() >= deadline) {
          setLimpError(`The robot did not report Limp — the robot side was not ${restart ? 'restarted' : 'stopped'}.`);
          return;
        }
        await new Promise((r) => setTimeout(r, LIMP_POLL_MS));
      }
      setConfirm(null);
      await (restart ? actions.restart() : actions.stop());
    } finally {
      setLimping(false);
    }
  };

  const errorLine = limpError ?? takeError ?? (lastError ? `${lastError.error}${lastError.code ? ` (${lastError.code})` : ''}` : null);

  const renderButtons = ({ compact = false, only, lit }: ReadinessButtonsOptions = {}): ReactNode => {
    const show = (id: ReadinessActionId) => (only ? only.includes(id) : id !== 'restart');
    const stepMode = lit !== undefined;
    const startB = show('start') && canStart && !restarting;
    const restartB = show('restart') && (side.restart || restarting);
    const armB = !compact && show('arm') && showArmSwitch;
    const takeB = armB && armBlockedReason !== null && take !== null;
    const readOnlyB = !compact && show('read_only') && showReadOnlySwitch;
    const stopB = !compact && show('stop') && canStop && !restarting;
    const logsB = !compact && show('logs');
    if (!bringup || !(startB || restartB || armB || readOnlyB || stopB || logsB)) return null;
    // In a step, the next action is lit: Start or Restart, else Take control, else the switch.
    const startVariant = stepMode && !lit ? 'secondary' : 'primary';
    const restartVariant = stepMode && !lit ? 'secondary' : 'primary';
    const takeVariant = stepMode && !lit ? 'secondary' : 'primary';
    const armVariant = stepMode && lit && !takeB && !startB && !restartB ? 'primary' : 'secondary';
    const takeButton = takeB && (
      <Button
        size={stepMode ? 'md' : 'sm'}
        variant={takeVariant}
        leftIcon={stepMode ? <Hand className="h-4 w-4" strokeWidth={1.75} /> : undefined}
        onClick={() => void takeControl(() => setConfirm('arm'))}
        disabled={busy || taking}
        isLoading={taking}
        loadingText="Taking control…"
        data-testid="readiness-take-control"
      >
        Take control
      </Button>
    );
    const armButton = armB && (
      <Button
        size={stepMode ? 'md' : 'sm'}
        variant={armVariant}
        leftIcon={<Activity className="h-4 w-4" strokeWidth={1.75} />}
        onClick={() => setConfirm('arm')}
        disabled={busy || armBlockedReason !== null}
        isLoading={pending?.action === 'sidecar-mode'}
        loadingText="Switching…"
        data-testid="readiness-arm-control"
      >
        Switch to arm control
      </Button>
    );
    const armBlocked = armB && armBlockedReason && !take && (stepMode ? (
      // In a step it is the step's one reason line, under the buttons.
      <p className="order-last m-0 flex basis-full items-start gap-2 text-[13px] text-ink-tertiary" data-testid="readiness-arm-blocked">
        <Lock className="mt-0.5 h-3.5 w-3.5 flex-none" strokeWidth={1.75} aria-hidden />
        {armBlockedReason}
      </p>
    ) : (
      <span className="text-[12px] text-ink-secondary" data-testid="readiness-arm-blocked">
        {armBlockedReason}
      </span>
    ));
    return (
      <div className={stepMode ? 'contents' : 'flex flex-wrap items-center gap-2'}>
        {startB && (
          <Button
            size={stepMode ? 'md' : 'sm'}
            variant={startVariant}
            leftIcon={<Play className="h-4 w-4" strokeWidth={1.75} />}
            onClick={() => void actions.start()}
            disabled={busy}
            isLoading={pending?.action === 'start'}
            loadingText="Starting…"
            data-testid="readiness-start"
          >
            Start robot side
          </Button>
        )}
        {restartB && (
          <Button
            size={stepMode ? 'md' : 'sm'}
            variant={restartVariant}
            leftIcon={<RotateCw className="h-4 w-4" strokeWidth={1.75} />}
            onClick={() => {
              setLimpError(null);
              setTakeError(null);
              setConfirm('restart');
            }}
            disabled={busy}
            isLoading={restarting}
            loadingText="Restarting…"
            data-testid="readiness-restart"
          >
            Restart robot side
          </Button>
        )}
        {armB && (stepMode ? (
          // A step reads in the order you press: take control, then switch.
          <>
            {takeButton}
            {armButton}
            {armBlocked}
          </>
        ) : (
          <span className="flex items-center gap-2">
            {armButton}
            {takeButton}
            {armBlocked}
          </span>
        ))}
        {readOnlyB && (
          <Button size={stepMode ? 'md' : 'sm'} variant="secondary" onClick={() => setConfirm('read_only')} disabled={busy} data-testid="readiness-read-only">
            Back to read-only
          </Button>
        )}
        {stopB && (
          <Button
            size="sm"
            variant="outline"
            leftIcon={<Square className="h-4 w-4" strokeWidth={1.75} />}
            onClick={() => {
              setLimpError(null);
              setTakeError(null);
              setConfirm('stop');
            }}
            disabled={busy && pending?.action !== 'start'}
            isLoading={pending?.action === 'stop'}
            loadingText="Stopping…"
            data-testid="readiness-stop"
          >
            Stop robot side
          </Button>
        )}
        {logsB && (
          <Button
            size="sm"
            variant="ghost"
            leftIcon={<ScrollText className="h-4 w-4" strokeWidth={1.75} />}
            onClick={() => setLogsOpen((v) => !v)}
            aria-expanded={logsOpen}
            data-testid="readiness-logs"
          >
            Logs
          </Button>
        )}
      </div>
    );
  };

  const errorNode = errorLine && (
    <p className="text-[12px] text-signal-stopped" role="alert" data-testid="readiness-error">
      {errorLine}
    </p>
  );
  const logsDrawer = logsOpen && bringup && (
    <BringupLogsDrawer robotId={robotId} procs={procs} api={logsApi} onClose={() => setLogsOpen(false)} />
  );
  const dialogs = (
    <>
      <ConfirmDialog
        isOpen={confirm === 'arm'}
        onClose={() => setConfirm(null)}
        onConfirm={switchToArmControl}
        title="Switch the robot side to arm control?"
        confirmLabel="Switch to arm control"
        testId="readiness-arm-confirm"
      >
        <ul className="list-disc space-y-1 pl-5 text-[13px] text-ink-secondary">
          <li>The sidecar restarts in arm_sdk mode — the path that can move the arms.</li>
          <li>Nothing moves until the robot is in Balance and an operator squeezes the grip.</li>
          <li>xr_teleoperate must not run at the same time. Stop it first.</li>
        </ul>
      </ConfirmDialog>

      <ConfirmDialog
        isOpen={confirm === 'read_only'}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          setConfirm(null);
          await actions.switchMode('read_only', null);
        }}
        title="Switch the robot side back to read-only?"
        description="The sidecar restarts read-only. The arms are released and can no longer be commanded."
        confirmLabel="Switch to read-only"
        testId="readiness-read-only-confirm"
      />

      {/* Stop and Restart share one confirm (TASK-430): a restart is a stop first. */}
      <ConfirmDialog
        isOpen={confirm === 'stop' || confirm === 'restart'}
        onClose={() => {
          if (!limping) setConfirm(null);
        }}
        onConfirm={restartDialog ? doRestart : doStop}
        title={restartDialog ? 'Restart the robot side?' : 'Stop the robot side?'}
        description={restartDialog ? RESTART_WORDS : STOP_SAFETY}
        confirmLabel={restartDialog ? 'Restart robot side' : 'Stop robot side'}
        tone="danger"
        isLoading={limping}
        testId={restartDialog ? 'readiness-restart-confirm' : 'readiness-stop-confirm'}
      >
        {offerLimp && (
          <div className="mt-3 rounded-control border border-signal-unknown/30 bg-signal-unknown/10 p-3 text-[13px]" data-testid="readiness-limp-offer">
            <p className="text-ink-primary">
              The robot is measured in <strong>{mode}</strong>. Once the sidecar is gone nobody can change its mode from here.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void limpThenStop()}
                disabled={!leaseBound || limping}
                isLoading={limping}
                loadingText="Waiting for Limp…"
                data-testid="readiness-limp-first"
              >
                {restartDialog ? 'Limp first, then restart' : 'Limp first, then stop'}
              </Button>
              {limpBlockedReason && take && (
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => void takeControl()}
                  disabled={limping || taking}
                  isLoading={taking}
                  loadingText="Taking control…"
                  data-testid="readiness-limp-take-control"
                >
                  Take control
                </Button>
              )}
              {limpBlockedReason && !take && <span className="text-[12px] text-ink-secondary">{limpBlockedReason}</span>}
            </div>
            {(limpError ?? takeError) && (
              <p className="mt-2 text-[12px] text-signal-stopped" role="alert">
                {limpError ?? takeError}
              </p>
            )}
          </div>
        )}
      </ConfirmDialog>
    </>
  );

  return { renderButtons, errorNode, logsDrawer, dialogs, busy, lanDown, actions, pending };
}

export interface ReadinessActionsProps extends ReadinessActionsOptions, ReadinessButtonsOptions {
  className?: string;
}

/**
 * The robot-side buttons on their own (TASK-427): Start robot side, Take
 * control, Switch to arm control, Back to read-only, Stop and Logs, each with
 * its confirmation, plus the error line and the logs drawer. `lit` gives the
 * next one the primary fill. Laid out flat (`display: contents`) inside a step,
 * so the host's own Details button sits in the same row.
 */
export function ReadinessActions({ only, lit, compact, className, ...opts }: ReadinessActionsProps) {
  const ra = useReadinessActions(opts);
  const buttons = ra.renderButtons({ compact, only, lit });
  return (
    <div className={cn(lit !== undefined ? 'contents' : 'flex flex-col gap-3', className)} data-testid="readiness-actions">
      {buttons}
      {ra.errorNode && <div className="basis-full">{ra.errorNode}</div>}
      {ra.logsDrawer && <div className="basis-full">{ra.logsDrawer}</div>}
      {ra.dialogs}
    </div>
  );
}

function ReadinessBody({
  robotId,
  variant = 'full',
  rows: only,
  lease = null,
  ready,
  baseModeApi = defaultBaseModeApi,
  logsApi,
  limpWaitMs = LIMP_WAIT_MS,
  questApi,
  className,
}: RobotReadinessPanelProps & { ready: UseRobotReadinessReturn }) {
  const { readiness, stale, readError } = ready;
  const ra = useReadinessActions({ robotId, lease, ready, baseModeApi, logsApi, limpWaitMs });
  const { busy, lanDown, actions, pending } = ra;

  const questPort = questPagePort();
  const rows = useMemo(() => (readiness ? readinessRows(readiness, questPort) : []), [readiness, questPort]);
  const highlight = readiness ? reasonRow(readiness) : null;
  const bringup = readiness?.bringup ?? null;
  const compact = variant === 'compact';
  const rowsOnly = variant === 'rows';
  const shown = rows.filter((r) => (bringup || !r.bringup) && (!compact || isFailing(r)) && (!only || only.includes(r.id)));
  const buttons = rowsOnly ? null : ra.renderButtons({ compact });

  const body = (
    <div className="flex flex-col gap-3">
      <ReadinessReasonLine readiness={readiness} stale={stale} readError={readError} size={compact ? 'sm' : 'lg'} />
      {buttons}
      {ra.errorNode}
      {shown.length > 0 && (
        <ul className="flex flex-col gap-1.5" aria-label="Readiness checklist">
          {shown.map((row) => (
            <ReadinessRow
              key={row.id}
              row={row}
              highlighted={row.id === highlight}
              onAdopt={(step) => void actions.adopt(step)}
              onLeave={(step) => void actions.leave(step)}
              busy={busy}
              action={
                row.id === 'quest' && !compact && !rowsOnly && readiness?.quest ? (
                  <QuestControls robotId={robotId} quest={readiness.quest} port={questPort} api={questApi} />
                ) : row.id === 'link' && lanDown ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    leftIcon={<Wifi className="h-4 w-4" strokeWidth={1.75} />}
                    onClick={() => void actions.lanUp()}
                    disabled={busy}
                    isLoading={pending?.action === 'lan-up'}
                    loadingText="Bringing up…"
                    data-testid="readiness-lan-up"
                  >
                    Bring up LAN
                  </Button>
                ) : undefined
              }
            />
          ))}
        </ul>
      )}
      {!compact && ra.logsDrawer}
    </div>
  );

  if (rowsOnly) {
    return shown.length > 0 ? (
      <ul className={cn('flex flex-col gap-1.5', className)} aria-label="Readiness checklist" data-testid="readiness-rows">
        {shown.map((row) => (
          <ReadinessRow
            key={row.id}
            row={row}
            highlighted={row.id === highlight}
            onAdopt={(step) => void actions.adopt(step)}
            onLeave={(step) => void actions.leave(step)}
            busy={busy}
            action={row.id === 'link' && lanDown ? (
              <Button
                size="sm"
                variant="secondary"
                leftIcon={<Wifi className="h-4 w-4" strokeWidth={1.75} />}
                onClick={() => void actions.lanUp()}
                disabled={busy}
                isLoading={pending?.action === 'lan-up'}
                loadingText="Bringing up…"
                data-testid="readiness-lan-up"
              >
                Bring up LAN
              </Button>
            ) : undefined}
          />
        ))}
      </ul>
    ) : (
      <p className={cn('text-[13px] text-ink-tertiary', className)}>Nothing reported yet.</p>
    );
  }

  return (
    <>
      {compact ? (
        <div className={className} data-testid="robot-readiness-compact">
          {body}
        </div>
      ) : (
        <Panel className={className} data-testid="robot-readiness">
          <Panel.Header
            title="Robot readiness"
            description={
              bringup
                ? `Robot side: ${bringup.overall}${bringup.sidecarMode ? ` · sidecar ${bringup.sidecarMode.replace('_', '-')}` : ''} · ${profileName(bringup.profile)}`
                : 'Why the arms are or are not following.'
            }
          />
          <Panel.Body>{body}</Panel.Body>
        </Panel>
      )}

      {ra.dialogs}
    </>
  );
}
