/**
 * @file RobotMarker.tsx
 * @description Robot marker on the fleet map: a status-coloured dot with the
 *   robot's name in Inter. Matte — no glow, no radar sweep.
 * @feature fleet
 * @dependencies @/features/fleet/types, @/features/fleet/utils
 */

import type { RobotMarkerProps } from '../types/fleet.types';
import { activateOnKey } from '../utils/svgButton';
import { robotStatusColor } from '../utils/mapColors';

/**
 * Only truncate genuinely long names — real robot names like
 * "Unitree G1 EDU" must render in full (there is ample space on the map).
 */
const MAX_LABEL_CHARS = 22;

/** True when the robot runs on a battery that is nearly flat. */
function isLowBattery(robot: RobotMarkerProps['robot']): boolean {
  return (
    robot.metadata?.powerSource !== 'ac_powered' &&
    robot.batteryLevel !== null &&
    robot.batteryLevel < 20
  );
}

/**
 * Robot marker icon for the fleet map. Keyboard-operable (Enter/Space).
 *
 * @example
 * ```tsx
 * <RobotMarker robot={robot} position={{ x: 100, y: 150 }} onClick={() => select(robot.robotId)} />
 * ```
 */
export function RobotMarker({ robot, position, isSelected, onClick }: RobotMarkerProps) {
  const color = robotStatusColor(robot.status);
  const label =
    robot.name.length > MAX_LABEL_CHARS
      ? `${robot.name.substring(0, MAX_LABEL_CHARS - 1)}…`
      : robot.name;

  return (
    <g
      className="cursor-pointer outline-none"
      transform={`translate(${position.x}, ${position.y})`}
      onClick={onClick}
      onKeyDown={activateOnKey(() => onClick?.())}
      role="button"
      tabIndex={0}
      aria-label={`${robot.name} - ${robot.status}`}
    >
      {/* Invisible hit area for a 44px touch target */}
      <circle cx="0" cy="0" r="22" fill="transparent" />

      {/* Selection ring */}
      {isSelected && (
        <circle cx="0" cy="0" r="17" fill="none" stroke="var(--color-primary)" strokeWidth="2" />
      )}

      {/* Body */}
      <circle cx="0" cy="0" r="11" fill="var(--bg-secondary)" stroke={color} strokeWidth="2" />
      <circle cx="0" cy="0" r="5.5" fill={color} />

      {/* Name */}
      <text
        x="0"
        y="28"
        textAnchor="middle"
        fontSize="11"
        fontWeight="500"
        fill="var(--text-secondary)"
        style={{ fontFamily: 'var(--font-sans, Inter, system-ui, sans-serif)' }}
      >
        {label}
      </text>

      {/* Low battery badge (skipped for AC-powered robots) */}
      {isLowBattery(robot) && (
        <g transform="translate(8, -18)">
          <rect x="0" y="0" width="14" height="9" rx="2" fill="var(--signal-stopped)" />
          <rect x="14" y="2.5" width="2" height="4" rx="0.5" fill="var(--signal-stopped)" />
          <title>Battery low</title>
        </g>
      )}
    </g>
  );
}
