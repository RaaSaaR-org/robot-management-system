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
 *              and the logs. Nothing here moves the robot; the only motion-
 *              adjacent step is Limp, through the existing confirmed base-mode
 *              route.
 *
 *              Variants: `full` (robot detail Teleop tab), `compact` (inside the
 *              VR launcher — the reason, the failing rows and Start, D5) and
 *              `line` (the VR window header — the reason only).
 * @feature robots
 */

import { useMemo, useState } from 'react';
import { Activity, Play, ScrollText, Square, Wifi } from 'lucide-react';
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
import { isFailing, readinessRows, reasonRow } from './readinessRows';

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
}

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
  className?: string;
}

export function ReadinessReasonLine({ readiness, stale = false, readError = null, size = 'lg', className }: ReadinessReasonLineProps) {
  if (!readiness) {
    return (
      <p className={cn('text-[13px] text-ink-secondary', className)} data-testid="readiness-reason" data-severity="unknown">
        {readError ? `Readiness not available: ${readError}` : 'Reading the robot’s readiness…'}
      </p>
    );
  }
  const { reason } = readiness;
  return (
    <div
      className={cn('flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-control border px-3 py-2', toneTag[SEVERITY_TONE[reason.severity]], className)}
      data-testid="readiness-reason"
      data-severity={reason.severity}
      data-code={reason.code}
      role="status"
    >
      <span className={cn('font-semibold', size === 'lg' ? 'text-[17px] leading-snug' : 'text-[13px]')}>{reason.text}</span>
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
  variant?: 'full' | 'compact' | 'line';
  /** The page's control lease; arm control and Limp first need it bound. */
  lease?: ReadinessLease | null;
  /** Inject a hook result (tests); otherwise reads live. */
  readiness?: UseRobotReadinessReturn;
  baseModeApi?: BaseModeApi;
  logsApi?: Pick<ReadinessApi, 'getBringupLogs' | 'streamBringupLogs'>;
  limpWaitMs?: number;
  /** The Quest buttons' calls (tests). */
  questApi?: QuestControlsApi;
  className?: string;
}

export function RobotReadinessPanel(props: RobotReadinessPanelProps) {
  const own = useRobotReadiness(props.robotId, { enabled: props.readiness === undefined });
  const ready = props.readiness ?? own;
  if (props.variant === 'line') {
    return <ReadinessReasonLine readiness={ready.readiness} stale={ready.stale} readError={ready.readError} size="sm" className={props.className} />;
  }
  return <ReadinessBody {...props} ready={ready} />;
}

function ReadinessBody({
  robotId,
  variant = 'full',
  lease = null,
  ready,
  baseModeApi = defaultBaseModeApi,
  logsApi,
  limpWaitMs = LIMP_WAIT_MS,
  questApi,
  className,
}: RobotReadinessPanelProps & { ready: UseRobotReadinessReturn }) {
  const { readiness, stale, readError, actions, pending, lastError } = ready;
  const baseMode = useRobotBaseMode(robotId, { api: baseModeApi, enabled: false });
  const [confirm, setConfirm] = useState<'arm' | 'read_only' | 'stop' | null>(null);
  const [limping, setLimping] = useState(false);
  const [limpError, setLimpError] = useState<string | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);

  const questPort = questPagePort();
  const rows = useMemo(() => (readiness ? readinessRows(readiness, questPort) : []), [readiness, questPort]);
  const highlight = readiness ? reasonRow(readiness) : null;
  const bringup = readiness?.bringup ?? null;
  const compact = variant === 'compact';
  const shown = rows.filter((r) => (bringup || !r.bringup) && (!compact || isFailing(r)));

  const overall = bringup?.overall ?? null;
  const busy = pending !== null || limping;
  const canStart = overall === 'stopped' || overall === 'error';
  const canStop = bringup !== null && overall !== 'stopped';
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
  const mode = measuredMode(readiness);
  const offerLimp = upright(mode);
  const linkStep = bringup?.steps.find((s) => s.id === 'link') ?? null;
  const lanDown = linkStep?.state === 'failed' && linkStep.code === 'no_host_ip';
  const procs: BringupProc[] = bringup?.robot === 'sim' ? ['sim', 'bridge', 'sidecar', 'agent'] : ['bridge', 'sidecar', 'agent'];

  const doStop = async () => {
    setConfirm(null);
    await actions.stop();
  };

  const limpThenStop = async () => {
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
          setLimpError('The robot did not report Limp — the robot side was not stopped.');
          return;
        }
        await new Promise((r) => setTimeout(r, LIMP_POLL_MS));
      }
      setConfirm(null);
      await actions.stop();
    } finally {
      setLimping(false);
    }
  };

  const errorLine = limpError ?? (lastError ? `${lastError.error}${lastError.code ? ` (${lastError.code})` : ''}` : null);

  // The compact variant offers Start only; an empty row would leave a gap.
  const buttons = bringup && (!compact || canStart) && (
    <div className="flex flex-wrap items-center gap-2">
      {canStart && (
        <Button
          size="sm"
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
      {!compact && showArmSwitch && (
        <span className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            leftIcon={<Activity className="h-4 w-4" strokeWidth={1.75} />}
            onClick={() => setConfirm('arm')}
            disabled={busy || armBlockedReason !== null}
            isLoading={pending?.action === 'sidecar-mode'}
            loadingText="Switching…"
            data-testid="readiness-arm-control"
          >
            Switch to arm control
          </Button>
          {armBlockedReason && (
            <span className="text-[12px] text-ink-secondary" data-testid="readiness-arm-blocked">
              {armBlockedReason}
            </span>
          )}
        </span>
      )}
      {!compact && showReadOnlySwitch && (
        <Button size="sm" variant="secondary" onClick={() => setConfirm('read_only')} disabled={busy} data-testid="readiness-read-only">
          Back to read-only
        </Button>
      )}
      {!compact && canStop && (
        <Button
          size="sm"
          variant="outline"
          leftIcon={<Square className="h-4 w-4" strokeWidth={1.75} />}
          onClick={() => {
            setLimpError(null);
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
      {!compact && (
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

  const body = (
    <div className="flex flex-col gap-3">
      <ReadinessReasonLine readiness={readiness} stale={stale} readError={readError} size={compact ? 'sm' : 'lg'} />
      {buttons}
      {errorLine && (
        <p className="text-[12px] text-signal-stopped" role="alert" data-testid="readiness-error">
          {errorLine}
        </p>
      )}
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
                row.id === 'quest' && !compact && readiness?.quest ? (
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
      {!compact && logsOpen && bringup && (
        <BringupLogsDrawer robotId={robotId} procs={procs} api={logsApi} onClose={() => setLogsOpen(false)} />
      )}
    </div>
  );

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

      <ConfirmDialog
        isOpen={confirm === 'arm'}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          setConfirm(null);
          await actions.switchMode('arm_sdk', lease?.grant() ?? null);
        }}
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

      <ConfirmDialog
        isOpen={confirm === 'stop'}
        onClose={() => {
          if (!limping) setConfirm(null);
        }}
        onConfirm={doStop}
        title="Stop the robot side?"
        description="The agent, sidecar and bridge stop. Stopping does not change the robot's mode."
        confirmLabel="Stop robot side"
        tone="danger"
        isLoading={limping}
        testId="readiness-stop-confirm"
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
                Limp first, then stop
              </Button>
              {limpBlockedReason && <span className="text-[12px] text-ink-secondary">{limpBlockedReason}</span>}
            </div>
            {limpError && (
              <p className="mt-2 text-[12px] text-signal-stopped" role="alert">
                {limpError}
              </p>
            )}
          </div>
        )}
      </ConfirmDialog>
    </>
  );
}
