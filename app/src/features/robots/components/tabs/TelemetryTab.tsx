/**
 * @file TelemetryTab.tsx
 * @description Telemetry tab showing system metrics and sensor data
 * @feature robots
 */

import { Card, Spinner, ProgressBar, Button } from '@/shared/components/ui';
import { UI_DATE_LOCALE, formatTimeAgo, CPU_THRESHOLDS, MEMORY_THRESHOLDS, getResourceVariant } from '@/shared/utils';
import { BatteryGauge } from '../BatteryGauge';
import { SensorGrid } from '../SensorGrid';
import { SimBadge } from '../SimBadge';
import {
  ImuCard,
  BatteryHealthCard,
  MotorTemperatureStrip,
  TelemetryHistorySparklines,
} from '../telemetry';
import { JointStateGrid, HandTouchPads } from '../visualization';
import { jointPositionUnit } from '../../types/robots.types';
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

const ErrorIcon = (
  <svg className="h-8 w-8 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
  </svg>
);

/** Shown when the telemetry stream errored before any data arrived. */
function TelemetryUnavailable({
  label,
  onRetry,
}: {
  label: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <div className="glass-subtle rounded-2xl p-4 mb-3">{ErrorIcon}</div>
      <p className="text-theme-secondary font-medium">{label}</p>
      <p className="text-sm text-gray-400 mt-1">
        The telemetry stream could not be reached
      </p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

// ============================================================================
// COMPONENT
// ============================================================================

export function TelemetryTab({
  robot,
  telemetry,
  isTelemetryConnected,
  telemetryLastUpdate,
  telemetryStatus,
  onTelemetryRetry,
}: TelemetryTabProps) {
  const isOffline = robot.status === 'offline';
  // Telemetry never arrived and the stream is in an error state — show an
  // explicit unavailable state instead of spinning forever.
  const isTelemetryError = !telemetry && !isOffline && telemetryStatus === 'error';
  // Live-frame field groups (each absent on robots without the hardware)
  const hasBatteryHealth = !!telemetry?.battery;
  const hasImu = !!telemetry?.imu?.rpy;
  const hasTouch = !!telemetry?.touch;
  // Real G1 frames carry no legacy `sensors` record — hide the card instead of
  // rendering a permanent empty state. Loading/offline/error states keep it.
  const hasSensors = !!telemetry?.sensors && Object.keys(telemetry.sensors).length > 0;

  const liveIndicator = isOffline ? (
    <div className="flex items-center gap-2">
      <div className="w-2 h-2 rounded-full bg-gray-500" />
      <span className="text-xs text-gray-400 font-medium">Offline</span>
    </div>
  ) : isTelemetryConnected ? (
    <div className="flex items-center gap-2">
      <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
      <span className="text-xs text-green-500 font-medium">Live</span>
    </div>
  ) : null;

  return (
    <div className="space-y-6">
      {/* Snapshot cards: system metrics + battery health + IMU + hand touch */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
      {/* System Metrics (full row when it's the only snapshot card) */}
      <Card className={hasBatteryHealth || hasImu || hasTouch ? undefined : 'lg:col-span-2'}>
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
                    {telemetryLastUpdate.toLocaleTimeString(UI_DATE_LOCALE)}
                  </span>
                )}
              </div>
            ) : null}
          </div>
        </Card.Header>
        <Card.Body>
          {telemetry ? (
            <div className="space-y-4">
              {/* The BMS card next door already covers power on robots that
                  report battery health — skip the duplicate gauge there. */}
              {!hasBatteryHealth && (
                <div className="flex items-center gap-6 p-4 rounded-xl glass-subtle">
                  <BatteryGauge
                    level={telemetry.batteryLevel}
                    voltage={telemetry.batteryVoltage}
                    temperature={telemetry.batteryTemperature}
                    charging={robot?.status === 'charging'}
                    powerSource={telemetry.powerSource}
                    size="lg"
                    showDetails
                  />
                  <div className="flex-1">
                    <div className="text-sm text-theme-secondary mb-1">Power Status</div>
                    <div className="text-lg font-semibold text-theme-primary">
                      {telemetry.batteryLevel === null || telemetry.powerSource === 'ac_powered'
                        ? 'AC Powered'
                        : `${telemetry.batteryLevel.toFixed(0)}%`}
                    </div>
                  </div>
                </div>
              )}

              {telemetry.cpuUsage != null ? (
                <ProgressBar
                  label="CPU Usage"
                  value={telemetry.cpuUsage}
                  variant={getResourceVariant(telemetry.cpuUsage, CPU_THRESHOLDS.WARNING, CPU_THRESHOLDS.ERROR)}
                />
              ) : (
                <div>
                  <div className="flex justify-between mb-1">
                    <span className="card-label">CPU Usage</span>
                    <span className="text-sm font-medium text-theme-tertiary">n/a</span>
                  </div>
                  <div className="h-1.5 glass-subtle rounded-full" />
                </div>
              )}
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
          ) : isTelemetryError ? (
            <TelemetryUnavailable label="Telemetry unavailable" onRetry={onTelemetryRetry} />
          ) : (
            <div className="flex items-center justify-center py-8">
              <Spinner size="md" color="cobalt" label="Loading telemetry..." />
            </div>
          )}
        </Card.Body>
      </Card>

      {/* Battery health + IMU (TASK-184 — rendered only when the frame has data) */}
      {telemetry && hasBatteryHealth && (
        <BatteryHealthCard telemetry={telemetry} charging={robot.status === 'charging'} />
      )}
      {telemetry && hasImu && <ImuCard telemetry={telemetry} />}

      {/* Dex3-1 hand touch pads */}
      {telemetry && hasTouch && (
        <Card>
          <Card.Header>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-theme-primary">Hand Touch</h2>
              {liveIndicator}
            </div>
          </Card.Header>
          <Card.Body>
            <HandTouchPads telemetry={telemetry} />
          </Card.Body>
        </Card>
      )}
      </div>

      {/* Motor temperature heatmap strip */}
      {telemetry && <MotorTemperatureStrip telemetry={telemetry} />}

      {/* Joint States */}
      <Card>
        <Card.Header>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-theme-primary">Joint States</h2>
              <SimBadge telemetry={telemetry} group="joints" />
            </div>
            {isTelemetryConnected && telemetry?.jointStates ? (
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <span className="text-xs text-green-500">Live</span>
              </div>
            ) : isOffline ? (
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-gray-500" />
                <span className="text-xs text-gray-400">Offline</span>
              </div>
            ) : null}
          </div>
        </Card.Header>
        <Card.Body>
          <JointStateGrid
            jointStates={telemetry?.jointStates ?? []}
            variant="compact"
            positionUnit={jointPositionUnit(telemetry?.robotType ?? robot.metadata?.robotType)}
          />
        </Card.Body>
      </Card>

      {/* Sensor Diagnostics (legacy `sensors` record — absent on real G1 frames) */}
      {(!telemetry || hasSensors) && (
      <Card>
        <Card.Header>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-theme-primary">Sensor Diagnostics</h2>
              <SimBadge telemetry={telemetry} group="sensors" />
            </div>
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
          ) : isTelemetryError ? (
            <TelemetryUnavailable label="Sensor data unavailable" onRetry={onTelemetryRetry} />
          ) : (
            <div className="flex items-center justify-center py-8">
              <Spinner size="md" color="cobalt" label="Loading sensors..." />
            </div>
          )}
        </Card.Body>
      </Card>
      )}

      {/* Battery SOC + max motor temp over the last hour */}
      <TelemetryHistorySparklines robotId={robot.id} />
    </div>
  );
}
