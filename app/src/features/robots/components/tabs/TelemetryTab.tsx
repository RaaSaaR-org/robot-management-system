/**
 * @file TelemetryTab.tsx
 * @description Telemetry tab — system readouts, battery, IMU, motor temperatures,
 *              history, hand touch, joints and sensors, each in its own panel
 * @feature robots
 */

import { Activity } from 'lucide-react';
import { EmptyState, ErrorState, Panel, Skeleton } from '@/shared/components/ui';
import { UI_DATE_LOCALE, formatTimeAgo, CPU_THRESHOLDS, MEMORY_THRESHOLDS } from '@/shared/utils';
import { BatteryGauge } from '../BatteryGauge';
import { SensorGrid } from '../SensorGrid';
import { SimBadge } from '../SimBadge';
import { ProvenanceTag, Readout, provenanceOf, type ReadoutTone } from '../common';
import {
  ImuCard,
  BatteryHealthCard,
  MotorTemperatureStrip,
  TelemetryHistorySparklines,
} from '../telemetry';
import { JointStateGrid, HandTouchPads } from '../visualization';
import { jointPositionUnit } from '../../types/robots.types';
import type { TelemetryTabProps } from './types';

/** Load tone for a percentage readout: warm at the warning threshold, hot at the error one. */
function loadTone(value: number, warning: number, error: number): ReadoutTone | undefined {
  if (value >= error) return 'stopped';
  if (value >= warning) return 'unknown';
  return undefined;
}

/** Thin load bar under a percentage readout. */
function LoadBar({ value, tone }: { value: number; tone?: ReadoutTone }) {
  const fill = tone === 'stopped' ? 'bg-signal-stopped' : tone === 'unknown' ? 'bg-signal-unknown' : 'bg-primary';
  return (
    <div className="h-1 overflow-hidden rounded-full bg-line-subtle" aria-hidden="true">
      <div className={`h-full rounded-full transition-[width] duration-300 ${fill}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

export function TelemetryTab({
  robot,
  telemetry,
  isTelemetryConnected,
  telemetryLastUpdate,
  telemetryStatus,
  onTelemetryRetry,
}: TelemetryTabProps) {
  const isOffline = robot.status === 'offline';
  // Telemetry never arrived and the stream is in an error state.
  const isTelemetryError = !telemetry && !isOffline && telemetryStatus === 'error';
  const source = provenanceOf(telemetry, isTelemetryConnected);

  // No frame at all: one calm panel instead of eight empty ones.
  if (!telemetry) {
    return (
      <div className="flex flex-col gap-6">
        <Panel>
          <Panel.Header title="Telemetry" actions={<ProvenanceTag source="none" />} />
          <Panel.Body>
            {isTelemetryError ? (
              <ErrorState
                title="Telemetry stream lost"
                message="The telemetry stream could not be reached."
                onRetry={onTelemetryRetry}
              />
            ) : isOffline ? (
              <EmptyState
                size="sm"
                icon={<Activity />}
                title="No telemetry yet"
                description={`${robot.name} is offline. Start its robot agent to see live telemetry. Last seen ${formatTimeAgo(robot.lastSeen)}.`}
              />
            ) : (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4" aria-label="Loading telemetry">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            )}
          </Panel.Body>
        </Panel>
        <TelemetryHistorySparklines robotId={robot.id} />
      </div>
    );
  }

  const hasBatteryHealth = !!telemetry.battery;
  const hasImu = !!telemetry.imu?.rpy;
  const hasTouch = !!telemetry.touch;
  // Real G1 frames carry no legacy `sensors` record — hide the panel then.
  const hasSensors = !!telemetry.sensors && Object.keys(telemetry.sensors).length > 0;
  const cpuTone = telemetry.cpuUsage != null
    ? loadTone(telemetry.cpuUsage, CPU_THRESHOLDS.WARNING, CPU_THRESHOLDS.ERROR)
    : undefined;
  const memTone = loadTone(telemetry.memoryUsage, MEMORY_THRESHOLDS.WARNING, MEMORY_THRESHOLDS.ERROR);
  const updated = telemetryLastUpdate
    ? `Updated ${telemetryLastUpdate.toLocaleTimeString(UI_DATE_LOCALE)}`
    : undefined;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
        <Panel className={hasBatteryHealth || hasImu || hasTouch ? undefined : 'xl:col-span-2'}>
          <Panel.Header title="System" description={updated} actions={<ProvenanceTag source={source} />} />
          <Panel.Body className="flex flex-col gap-5">
            {/* The battery-health panel covers power on BMS robots — skip the duplicate gauge there. */}
            {!hasBatteryHealth && (
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <BatteryGauge
                  level={telemetry.batteryLevel}
                  voltage={telemetry.batteryVoltage}
                  temperature={telemetry.batteryTemperature}
                  charging={robot.status === 'charging'}
                  powerSource={telemetry.powerSource}
                  size="lg"
                  showDetails
                />
              </div>
            )}
            <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
              <div className="flex flex-col gap-2">
                <Readout label="CPU" value={telemetry.cpuUsage?.toFixed(0)} unit="%" tone={cpuTone} />
                {telemetry.cpuUsage != null && <LoadBar value={telemetry.cpuUsage} tone={cpuTone} />}
              </div>
              <div className="flex flex-col gap-2">
                <Readout label="Memory" value={telemetry.memoryUsage.toFixed(0)} unit="%" tone={memTone} />
                <LoadBar value={telemetry.memoryUsage} tone={memTone} />
              </div>
              <Readout label="Temperature" value={telemetry.temperature.toFixed(1)} unit="°C" />
              <Readout label="Speed" value={telemetry.speed?.toFixed(2)} unit="m/s" />
            </div>
          </Panel.Body>
        </Panel>

        {hasBatteryHealth && (
          <BatteryHealthCard telemetry={telemetry} charging={robot.status === 'charging'} />
        )}
        {hasImu && <ImuCard telemetry={telemetry} />}

        {hasTouch && (
          <Panel>
            <Panel.Header title="Hand touch" actions={<SimBadge telemetry={telemetry} group="touch" />} />
            <Panel.Body>
              <HandTouchPads telemetry={telemetry} />
            </Panel.Body>
          </Panel>
        )}
      </div>

      <MotorTemperatureStrip telemetry={telemetry} />

      <TelemetryHistorySparklines robotId={robot.id} />

      <Panel>
        <Panel.Header title="Joints" actions={<SimBadge telemetry={telemetry} group="joints" />} />
        <Panel.Body>
          <JointStateGrid
            jointStates={telemetry.jointStates ?? []}
            variant="compact"
            positionUnit={jointPositionUnit(telemetry.robotType ?? robot.metadata?.robotType)}
          />
        </Panel.Body>
      </Panel>

      {hasSensors && telemetry.sensors && (
        <Panel>
          <Panel.Header title="Sensors" actions={<SimBadge telemetry={telemetry} group="sensors" />} />
          <Panel.Body>
            <SensorGrid sensors={telemetry.sensors} columns={3} />
          </Panel.Body>
        </Panel>
      )}
    </div>
  );
}
