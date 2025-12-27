/**
 * @file Model3DTab.tsx
 * @description 3D Model tab with robot visualization and joint states
 * @feature robots
 */

import { Suspense, lazy } from 'react';
import { Card, Badge } from '@/shared/components/ui';
import { JointStateGrid, Robot3DViewerFallback } from '../visualization';
import type { RobotType } from '../../types/robots.types';
import type { Model3DTabProps } from './types';

// Lazy load 3D viewer to reduce initial bundle size
const Robot3DViewer = lazy(() =>
  import('../visualization/Robot3DViewer').then((m) => ({ default: m.Robot3DViewer }))
);

// ============================================================================
// COMPONENT
// ============================================================================

export function Model3DTab({ robot, telemetry, isTelemetryConnected }: Model3DTabProps) {
  const isOffline = robot.status === 'offline';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* 3D Viewer */}
      <Card className="min-h-[400px]">
        <Card.Header>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-theme-primary">3D Model</h2>
            {telemetry?.robotType && (
              <Badge variant="cobalt" size="sm">
                {telemetry.robotType.toUpperCase()}
              </Badge>
            )}
          </div>
        </Card.Header>
        <Card.Body className="p-0 h-[350px]">
          <Suspense fallback={<Robot3DViewerFallback />}>
            <Robot3DViewer
              robotType={(telemetry?.robotType as RobotType) ?? (robot.metadata?.robotType as RobotType) ?? 'generic'}
              jointStates={telemetry?.jointStates}
              isAnimating={isTelemetryConnected}
            />
          </Suspense>
        </Card.Body>
      </Card>

      {/* Joint States */}
      <Card>
        <Card.Header>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-theme-primary">Joint States</h2>
            {isTelemetryConnected && telemetry?.jointStates ? (
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <span className="text-xs text-green-500 font-medium">Live</span>
              </div>
            ) : isOffline ? (
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-gray-500" />
                <span className="text-xs text-gray-400 font-medium">Offline</span>
              </div>
            ) : null}
          </div>
        </Card.Header>
        <Card.Body className="max-h-[350px] overflow-y-auto">
          <JointStateGrid jointStates={telemetry?.jointStates ?? []} columns={2} />
        </Card.Body>
      </Card>
    </div>
  );
}
