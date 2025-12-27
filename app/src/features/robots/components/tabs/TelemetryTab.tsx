/**
 * @file TelemetryTab.tsx
 * @description Telemetry tab showing system metrics and sensor data
 * @feature robots
 */

import { Card, Spinner, ProgressBar } from '@/shared/components/ui';
import { formatTimeAgo, CPU_THRESHOLDS, MEMORY_THRESHOLDS, getResourceVariant } from '@/shared/utils';
import { BatteryGauge } from '../BatteryGauge';
import { SensorGrid } from '../SensorGrid';
import type { TelemetryTabProps } from './types';

// ============================================================================
// ICONS
// ============================================================================

const TelemetryIcon = (
  <svg className="h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
  </svg>
);

const SensorIcon = (
  <svg className="h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9.348 14.651a3.75 3.75 0 010-5.303m5.304 0a3.75 3.75 0 010 5.303m-7.425 2.122a6.75 6.75 0 010-9.546m9.546 0a6.75 6.75 0 010 9.546M5.106 18.894c-3.808-3.808-3.808-9.98 0-13.789m13.788 0c3.808 3.808 3.808 9.981 0 13.789M12 12h.008v.008H12V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
  </svg>
);

// ============================================================================
// COMPONENT
// ============================================================================

export function TelemetryTab({
  robot,
  telemetry,
  isTelemetryConnected,
  telemetryLastUpdate,
}: TelemetryTabProps) {
  const isOffline = robot.status === 'offline';

  return (
    <div className="space-y-6">
      {/* System Metrics */}
      <Card>
        <Card.Header>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-theme-primary">System Metrics</h2>
            {isOffline ? (
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-gray-500" />
                <span className="text-xs text-gray-400 font-medium">Offline</span>
              </div>
            ) : isTelemetryConnected ? (
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <span className="text-xs text-green-500 font-medium">Live</span>
                {telemetryLastUpdate && (
                  <span className="text-xs text-theme-tertiary">
                    {telemetryLastUpdate.toLocaleTimeString()}
                  </span>
                )}
              </div>
            ) : null}
          </div>
        </Card.Header>
        <Card.Body>
          {telemetry ? (
            <div className="space-y-4">
              <div className="flex items-center gap-6 p-4 rounded-xl glass-subtle">
                <BatteryGauge
                  level={telemetry.batteryLevel}
                  voltage={telemetry.batteryVoltage}
                  temperature={telemetry.batteryTemperature}
                  charging={robot?.status === 'charging'}
                  size="lg"
                  showDetails
                />
                <div className="flex-1">
                  <div className="text-sm text-theme-secondary mb-1">Battery Status</div>
                  <div className="text-lg font-semibold text-theme-primary">
                    {telemetry.batteryLevel.toFixed(0)}%
                  </div>
                </div>
              </div>

              <ProgressBar
                label="CPU Usage"
                value={telemetry.cpuUsage}
                variant={getResourceVariant(telemetry.cpuUsage, CPU_THRESHOLDS.WARNING, CPU_THRESHOLDS.ERROR)}
              />
              <ProgressBar
                label="Memory Usage"
                value={telemetry.memoryUsage}
                variant={getResourceVariant(telemetry.memoryUsage, MEMORY_THRESHOLDS.WARNING, MEMORY_THRESHOLDS.ERROR)}
              />

              <div className="pt-4 border-t border-glass-subtle">
                <div className="grid grid-cols-2 gap-4">
                  <div className="glass-subtle p-3 rounded-lg">
                    <span className="card-label">Temperature</span>
                    <p className="text-lg font-semibold text-theme-primary">{telemetry.temperature.toFixed(1)}°C</p>
                  </div>
                  {telemetry.speed !== undefined && (
                    <div className="glass-subtle p-3 rounded-lg">
                      <span className="card-label">Speed</span>
                      <p className="text-lg font-semibold text-theme-primary">{telemetry.speed.toFixed(2)} m/s</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : isOffline ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="glass-subtle rounded-2xl p-4 mb-3">
                {TelemetryIcon}
              </div>
              <p className="text-theme-secondary font-medium">Telemetry data unavailable</p>
              <p className="text-sm text-gray-400 mt-1">
                Last connected {formatTimeAgo(robot.lastSeen)}
              </p>
            </div>
          ) : (
            <div className="flex items-center justify-center py-8">
              <Spinner size="md" color="cobalt" label="Loading telemetry..." />
            </div>
          )}
        </Card.Body>
      </Card>

      {/* Sensor Diagnostics */}
      <Card>
        <Card.Header>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-theme-primary">Sensor Diagnostics</h2>
            {isOffline ? (
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-gray-500" />
                <span className="text-xs text-gray-400">Offline</span>
              </div>
            ) : isTelemetryConnected && telemetry?.sensors ? (
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <span className="text-xs text-green-500">Live</span>
              </div>
            ) : null}
          </div>
        </Card.Header>
        <Card.Body>
          {telemetry?.sensors ? (
            <SensorGrid sensors={telemetry.sensors} columns={2} />
          ) : isOffline ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="glass-subtle rounded-2xl p-4 mb-3">
                {SensorIcon}
              </div>
              <p className="text-theme-secondary font-medium">Sensor data unavailable</p>
              <p className="text-sm text-gray-400 mt-1">
                Robot is currently offline
              </p>
            </div>
          ) : (
            <div className="flex items-center justify-center py-8">
              <Spinner size="md" color="cobalt" label="Loading sensors..." />
            </div>
          )}
        </Card.Body>
      </Card>
    </div>
  );
}
