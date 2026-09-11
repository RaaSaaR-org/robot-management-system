/**
 * @file OverviewTab.tsx
 * @description Default robot view: the live 3D model alongside the controls an
 *              operator reaches for first — start a VLA skill, send to charge,
 *              return home — and odometry when the frame carries it.
 * @feature robots
 */

import { Suspense, lazy } from 'react';
import { BatteryCharging, Home } from 'lucide-react';
import { Button, Panel, StatusTag } from '@/shared/components/ui';
import { Robot3DViewerFallback } from '../visualization';
import { VlaControlSection } from '../VlaControlSection';
import { ProvenanceTag, Readout, provenanceOf } from '../common';
import {
  ROBOT_STATUS_LABELS,
  isRobotAvailable,
  normalizeRobotType,
} from '../../types/robots.types';
import type { OdometryState } from '../../types/robots.types';
import type { OverviewTabProps } from './types';

// Lazy-load the 3D viewer to keep it out of the initial bundle.
const Robot3DViewer = lazy(() =>
  import('../visualization/Robot3DViewer').then((m) => ({ default: m.Robot3DViewer }))
);

const ICON = 'h-4 w-4';

/** Ground speed for an odometry frame: |velocity|, falling back to |yawSpeed|. */
function odometrySpeed(odometry: OdometryState): { value: number; unit: string } | null {
  if (odometry.velocity) {
    const [vx, vy, vz] = odometry.velocity;
    return { value: Math.sqrt(vx * vx + vy * vy + vz * vz), unit: 'm/s' };
  }
  if (odometry.yawSpeed != null) {
    return { value: Math.abs(odometry.yawSpeed), unit: 'rad/s' };
  }
  return null;
}

export function OverviewTab({
  robot,
  robotId,
  telemetry,
  isTelemetryConnected,
  isCommandLoading,
  canExecuteCommands,
  onSendToCharge,
  onReturnHome,
}: OverviewTabProps) {
  const reportedType =
    telemetry?.robotType ?? (robot.metadata?.robotType as string | undefined) ?? 'generic';
  const robotType = normalizeRobotType(reportedType);
  const odometry = telemetry?.odometry ?? null;
  const speed = odometry ? odometrySpeed(odometry) : null;
  const statusLabel =
    ROBOT_STATUS_LABELS[robot.status as keyof typeof ROBOT_STATUS_LABELS] ?? robot.status;

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
      <Panel className="xl:col-span-2">
        <Panel.Header
          title="Live model"
          description={
            telemetry?.jointStates?.length
              ? 'Posed from live joint states.'
              : 'Default pose — no joint states yet.'
          }
          actions={
            <>
              <StatusTag tone="neutral">{reportedType.replace(/[_-]+/g, ' ')}</StatusTag>
              <ProvenanceTag source={provenanceOf(telemetry, isTelemetryConnected)} />
            </>
          }
        />
        <div className="h-[280px] border-t border-line-subtle sm:h-[340px] lg:h-[440px]">
          <Suspense fallback={<Robot3DViewerFallback className="h-full" />}>
            <Robot3DViewer
              robotType={robotType}
              jointStates={telemetry?.jointStates}
              isAnimating={isTelemetryConnected}
              robotId={robotId}
            />
          </Suspense>
        </div>
      </Panel>

      <div className="flex flex-col gap-6">
        <VlaControlSection robotId={robotId} />

        <Panel>
          <Panel.Header title="Quick actions" />
          <Panel.Body className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="secondary"
                size="sm"
                fullWidth
                disabled={!canExecuteCommands}
                isLoading={isCommandLoading}
                onClick={() => void onSendToCharge()}
                leftIcon={<BatteryCharging className={ICON} strokeWidth={1.75} />}
              >
                Charge
              </Button>
              <Button
                variant="secondary"
                size="sm"
                fullWidth
                disabled={!canExecuteCommands}
                isLoading={isCommandLoading}
                onClick={() => void onReturnHome()}
                leftIcon={<Home className={ICON} strokeWidth={1.75} />}
              >
                Home
              </Button>
            </div>
            {!isRobotAvailable(robot) && (
              <p className="text-xs text-ink-tertiary">
                Robot must be online to receive commands — currently{' '}
                <span className="text-ink-secondary">{statusLabel.toLowerCase()}</span>.
              </p>
            )}
          </Panel.Body>
        </Panel>

        {/* Odometry (TASK-184) — only when the frame carries it */}
        {odometry && (
          <Panel>
            <Panel.Header title="Odometry" actions={<ProvenanceTag source={provenanceOf(telemetry)} />} />
            <Panel.Body className="flex flex-col gap-4">
              <div className="grid grid-cols-3 gap-3">
                {(['x', 'y', 'z'] as const).map((axis, i) => (
                  <Readout key={axis} label={axis} value={odometry.position[i].toFixed(2)} unit="m" />
                ))}
              </div>
              {speed && <Readout label="Speed" value={speed.value.toFixed(2)} unit={speed.unit} />}
            </Panel.Body>
          </Panel>
        )}
      </div>
    </div>
  );
}
