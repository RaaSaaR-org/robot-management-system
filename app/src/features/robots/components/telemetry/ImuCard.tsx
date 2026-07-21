/**
 * @file ImuCard.tsx
 * @description IMU telemetry card — roll/pitch/yaw, artificial-horizon indicator, gyro magnitude
 * @feature robots
 */

import { memo } from 'react';
import { Card } from '@/shared/components/ui';
import { SimBadge } from '../SimBadge';
import type { RobotTelemetry } from '../../types/robots.types';

// ============================================================================
// HELPERS
// ============================================================================

const RAD_TO_DEG = 180 / Math.PI;

/** Vector magnitude of a 3-tuple */
function magnitude(v: [number, number, number]): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

// ============================================================================
// HORIZON INDICATOR
// ============================================================================

/**
 * Minimal artificial-horizon / level indicator: the horizon line rotates with
 * roll and shifts with pitch inside a circular bezel.
 */
function HorizonIndicator({ rollDeg, pitchDeg }: { rollDeg: number; pitchDeg: number }) {
  // Pitch shift: 1° of pitch = 0.6 SVG units, clamped inside the bezel.
  const pitchShift = Math.max(-24, Math.min(24, pitchDeg * 0.6));

  return (
    <svg
      viewBox="-40 -40 80 80"
      className="w-20 h-20 shrink-0"
      role="img"
      aria-label={`Attitude: roll ${rollDeg.toFixed(1)} degrees, pitch ${pitchDeg.toFixed(1)} degrees`}
    >
      <defs>
        <clipPath id="imu-horizon-clip">
          <circle cx="0" cy="0" r="34" />
        </clipPath>
      </defs>
      {/* Bezel */}
      <circle
        cx="0"
        cy="0"
        r="35"
        className="fill-none stroke-[var(--border-color-strong)]"
        strokeWidth="1.5"
      />
      <g clipPath="url(#imu-horizon-clip)">
        {/* Sky */}
        <rect x="-40" y="-40" width="80" height="80" className="fill-cobalt-500/15" />
        {/* Ground — rotates with roll, shifts with pitch */}
        <g transform={`rotate(${-rollDeg}) translate(0 ${pitchShift})`}>
          <rect x="-60" y="0" width="120" height="80" className="fill-yellow-500/15" />
          <line x1="-60" y1="0" x2="60" y2="0" className="stroke-turquoise-500" strokeWidth="1.5" />
        </g>
      </g>
      {/* Fixed aircraft reference */}
      <line x1="-14" y1="0" x2="-5" y2="0" className="stroke-[var(--text-secondary)]" strokeWidth="2" strokeLinecap="round" />
      <line x1="5" y1="0" x2="14" y2="0" className="stroke-[var(--text-secondary)]" strokeWidth="2" strokeLinecap="round" />
      <circle cx="0" cy="0" r="1.6" className="fill-[var(--text-secondary)]" />
    </svg>
  );
}

// ============================================================================
// COMPONENT
// ============================================================================

export interface ImuCardProps {
  /** Current telemetry frame (reads `telemetry.imu`) */
  telemetry: RobotTelemetry;
}

/**
 * IMU card: roll/pitch/yaw in degrees (1 decimal), a small artificial-horizon
 * indicator, and the gyro magnitude. Renders nothing without IMU data.
 */
export const ImuCard = memo(function ImuCard({ telemetry }: ImuCardProps) {
  const imu = telemetry.imu;
  if (!imu?.rpy) return null;

  // Hardware reports rpy/gyro in radians (Unitree LowState convention).
  const [rollDeg, pitchDeg, yawDeg] = imu.rpy.map((v) => v * RAD_TO_DEG) as [number, number, number];
  const gyroMag = imu.gyro ? magnitude(imu.gyro) : null;

  const axes: Array<{ label: string; value: number }> = [
    { label: 'Roll', value: rollDeg },
    { label: 'Pitch', value: pitchDeg },
    { label: 'Yaw', value: yawDeg },
  ];

  return (
    <Card>
      <Card.Header>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-theme-primary">IMU</h2>
            <SimBadge telemetry={telemetry} group="imu" />
          </div>
          {imu.temperature != null && (
            <span
              className="text-xs text-theme-tertiary"
              title="IMU die temperature — the sensor chip normally runs much hotter than the motors; this is not a motor temperature"
            >
              IMU temp {imu.temperature.toFixed(0)}°C
            </span>
          )}
        </div>
      </Card.Header>
      <Card.Body>
        <div className="flex items-center gap-4">
          <HorizonIndicator rollDeg={rollDeg} pitchDeg={pitchDeg} />
          <div className="flex-1 grid grid-cols-3 gap-2">
            {axes.map(({ label, value }) => (
              <div key={label} className="glass-subtle p-2.5 rounded-lg text-center">
                <span className="card-label">{label}</span>
                <p className="font-mono text-sm font-semibold text-theme-primary">
                  {value.toFixed(1)}°
                </p>
              </div>
            ))}
          </div>
        </div>
        {gyroMag !== null && (
          <div className="mt-3 pt-3 border-t border-glass-subtle flex items-center justify-between text-xs">
            <span className="text-theme-secondary">Angular rate (gyro magnitude)</span>
            <span className="font-mono text-theme-primary">{gyroMag.toFixed(3)} rad/s</span>
          </div>
        )}
      </Card.Body>
    </Card>
  );
});
