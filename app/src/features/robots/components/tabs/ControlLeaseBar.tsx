/**
 * @file ControlLeaseBar.tsx
 * @description The control-lease strip a teleop view shows when the server
 *              advertises leases (TASK-319): who holds the robot and for how
 *              long, "Take control" / "Release control", the conflict and
 *              lost-control banners, and an E-stop that no lease state disables.
 * @feature robots
 */

import { useEffect, useState } from 'react';
import { Hand, LogOut } from 'lucide-react';
import { Button, StatusTag, confirm } from '@/shared/components/ui';
import { RobotEmergencyStopButton } from '@/features/safety';
import type { ControlLeaseHolder } from '../../api/controlLeaseApi';
import type { UseControlLeaseReturn } from '../../hooks/useControlLease';

export interface ControlLeaseBarProps {
  lease: UseControlLeaseReturn;
  robotId: string;
  robotName: string;
  /** The view's agent socket is open — taking control needs one to bind. */
  connected: boolean;
}

/** Seconds until `expiresAt`, re-read every second; null without a deadline. */
function useSecondsLeft(expiresAt: string | undefined): number | null {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  if (!expiresAt) return null;
  const at = Date.parse(expiresAt);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, Math.ceil((at - nowMs) / 1000));
}

export function holderLabel(holder: ControlLeaseHolder, secondsLeft: number | null): string {
  const base = `Controlled by ${holder.displayName}`;
  return secondsLeft === null ? base : `${base} · expires in ${secondsLeft} s`;
}

export function ControlLeaseBar({ lease, robotId, robotName, connected }: ControlLeaseBarProps) {
  const { state, holder, notice } = lease;
  const secondsLeft = useSecondsLeft(holder?.expiresAt);

  const takeControl = async (): Promise<void> => {
    const ok = await confirm({
      title: `Take control of ${robotName}?`,
      description:
        'You become the only operator who can drive it until you release control, leave this page or the connection drops.',
      confirmLabel: 'Take control',
      testId: 'control-lease-confirm',
    });
    if (ok) await lease.acquire();
  };

  return (
    <div className="flex flex-col gap-2" data-testid="control-lease-bar">
      <div className="flex flex-wrap items-center gap-2">
        {state === 'bound' ? (
          <StatusTag tone="live" dot pulse>
            You have control
          </StatusTag>
        ) : holder ? (
          <StatusTag tone="warning" dot data-testid="control-lease-holder">
            {holderLabel(holder, secondsLeft)}
          </StatusTag>
        ) : (
          <StatusTag tone="neutral" dot>
            Observing — nobody has control
          </StatusTag>
        )}
        <div className="ml-auto flex items-center gap-2">
          {state === 'bound' ? (
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<LogOut className="h-4 w-4" strokeWidth={1.75} />}
              onClick={lease.release}
            >
              Release control
            </Button>
          ) : (
            <Button
              size="sm"
              leftIcon={<Hand className="h-4 w-4" strokeWidth={1.75} />}
              onClick={() => void takeControl()}
              disabled={!connected}
              isLoading={state === 'acquiring'}
              loadingText="Taking control…"
            >
              Take control
            </Button>
          )}
          <RobotEmergencyStopButton robotId={robotId} robotName={robotName} size="sm" />
        </div>
      </div>
      {notice && (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 rounded-control border border-line bg-inset px-3 py-2 text-[13px] text-ink-primary"
          data-testid={`control-lease-notice-${notice.kind}`}
        >
          <span>
            <span className="font-medium">
              {notice.kind === 'lost' ? 'Control lost. ' : notice.kind === 'conflict' ? 'Robot in use. ' : ''}
            </span>
            {notice.message}
          </span>
          <Button variant="ghost" size="sm" onClick={lease.dismissNotice}>
            Dismiss
          </Button>
        </div>
      )}
    </div>
  );
}
