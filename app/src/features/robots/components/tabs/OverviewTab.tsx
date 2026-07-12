/**
 * @file OverviewTab.tsx
 * @description Default robot view: the live 3D model alongside the controls an
 *              operator reaches for first — assign a VLA task, send to charge,
 *              return home. Deeper data (telemetry, commands, tasks) lives in the
 *              sibling tabs.
 * @feature robots
 */

import { Suspense, lazy } from 'react';
import { Card, Button, Badge } from '@/shared/components/ui';
import { Robot3DViewerFallback } from '../visualization';
import { VlaControlSection } from '../VlaControlSection';
import { SimBadge } from '../SimBadge';
import { isRobotAvailable, normalizeRobotType } from '../../types/robots.types';
import type { OdometryState } from '../../types/robots.types';
import type { OverviewTabProps } from './types';

// Lazy-load the 3D viewer to keep it out of the initial bundle.
const Robot3DViewer = lazy(() =>
  import('../visualization/Robot3DViewer').then((m) => ({ default: m.Robot3DViewer }))
);

// ============================================================================
// ICONS
// ============================================================================

const ChargeIcon = (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
  </svg>
);

const HomeIcon = (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955a1.5 1.5 0 012.122 0L22.5 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75" />
  </svg>
);

// ============================================================================
// HELPERS
// ============================================================================

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

// ============================================================================
// COMPONENT
// ============================================================================

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

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
      {/* Live 3D model — the visual anchor of the page */}
      <Card className="overflow-hidden p-0">
        <div className="flex items-center justify-between px-4 py-3 border-b border-theme">
          <h2 className="text-sm font-semibold text-theme-primary">Live Model</h2>
          <div className="flex items-center gap-2">
            <Badge variant="cobalt" size="sm">{reportedType.toUpperCase()}</Badge>
            <span className="flex items-center gap-1.5 text-xs text-theme-tertiary">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isTelemetryConnected ? 'bg-green-500 animate-pulse' : 'bg-gray-500'
                }`}
              />
              {isTelemetryConnected ? 'Live' : 'Offline'}
            </span>
          </div>
        </div>
        <div className="h-[340px] lg:h-[440px]">
          <Suspense fallback={<Robot3DViewerFallback className="h-full" />}>
            <Robot3DViewer
              robotType={robotType}
              jointStates={telemetry?.jointStates}
              isAnimating={isTelemetryConnected}
            />
          </Suspense>
        </div>
      </Card>

      {/* Primary controls */}
      <div className="flex flex-col gap-4">
        <VlaControlSection robotId={robotId} />

        <Card className="p-4">
          <h3 className="mb-3 text-sm font-semibold text-theme-primary">Quick Actions</h3>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              size="sm"
              fullWidth
              disabled={!canExecuteCommands}
              isLoading={isCommandLoading}
              onClick={onSendToCharge}
              leftIcon={ChargeIcon}
            >
              Charge
            </Button>
            <Button
              variant="outline"
              size="sm"
              fullWidth
              disabled={!canExecuteCommands}
              isLoading={isCommandLoading}
              onClick={onReturnHome}
              leftIcon={HomeIcon}
            >
              Home
            </Button>
          </div>
          {!isRobotAvailable(robot) && (
            <p className="mt-3 text-xs text-theme-tertiary">
              Robot must be online to receive commands — currently{' '}
              <span className="capitalize text-theme-secondary">{robot.status}</span>.
            </p>
          )}
        </Card>

        {/* Odometry (TASK-184) — only when the frame carries it */}
        {odometry && (
          <Card className="p-4">
            <div className="mb-3 flex items-center gap-2">
              <h3 className="text-sm font-semibold text-theme-primary">Odometry</h3>
              <SimBadge telemetry={telemetry} group="odometry" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(['x', 'y', 'z'] as const).map((axis, i) => (
                <div key={axis} className="glass-subtle p-2 rounded-lg text-center">
                  <span className="card-label">{axis}</span>
                  <p className="font-mono text-sm font-semibold text-theme-primary">
                    {odometry.position[i].toFixed(2)} m
                  </p>
                </div>
              ))}
            </div>
            {speed && (
              <div className="mt-2 flex items-center justify-between text-xs">
                <span className="text-theme-secondary">Speed</span>
                <span className="font-mono text-theme-primary">
                  {speed.value.toFixed(2)} {speed.unit}
                </span>
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
