/**
 * @file RobotMarker.tsx
 * @description Futuristic robot marker component for fleet map with glow and pulse effects
 * @feature fleet
 * @dependencies @/shared/utils/cn, @/features/fleet/types
 */

import type { RobotMarkerProps } from '../types/fleet.types';

// ============================================================================
// CONSTANTS
// ============================================================================

// Futuristic status colors with glow
const STATUS_COLORS = {
  online: '#18E4C3',   // turquoise
  busy: '#3b82f6',     // blue
  charging: '#eab308', // yellow
  error: '#ef4444',    // red
  maintenance: '#f97316', // orange
  offline: '#6b7280',  // gray
} as const;

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Futuristic robot marker icon for the fleet map.
 * Shows robot position with glow effects, pulse rings, and status-colored indicators.
 *
 * @example
 * ```tsx
 * <RobotMarker
 *   robot={robot}
 *   position={{ x: 100, y: 150 }}
 *   onClick={() => handleRobotClick(robot.robotId)}
 * />
 * ```
 */
export function RobotMarker({ robot, position, isSelected, onClick }: RobotMarkerProps) {
  const statusColor = STATUS_COLORS[robot.status as keyof typeof STATUS_COLORS] || STATUS_COLORS.offline;

  return (
    <g
      className="cursor-pointer"
      transform={`translate(${position.x}, ${position.y})`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      aria-label={`${robot.name} - ${robot.status}`}
    >
      {/* Outer pulse rings - always visible but subtle */}
      <circle
        cx="0"
        cy="0"
        r="18"
        fill="none"
        stroke={statusColor}
        strokeWidth="1"
        opacity="0.3"
        style={{ animation: 'pulseRing 2s ease-out infinite' }}
      />
      <circle
        cx="0"
        cy="0"
        r="18"
        fill="none"
        stroke={statusColor}
        strokeWidth="1"
        opacity="0.2"
        style={{ animation: 'pulseRing 2s ease-out infinite 0.5s' }}
      />

      {/* Selected/Error state - extra pulse */}
      {(isSelected || robot.status === 'error') && (
        <circle
          cx="0"
          cy="0"
          r="22"
          fill="none"
          stroke={statusColor}
          strokeWidth="2"
          opacity="0.5"
          className="animate-ping"
        />
      )}

      {/* Radar sweep for selected robot */}
      {isSelected && (
        <g style={{ animation: 'radarSweep 2s linear infinite' }}>
          <path
            d="M 0 0 L 20 -12 A 24 24 0 0 1 20 12 Z"
            fill={`${statusColor}20`}
          />
        </g>
      )}

      {/* Glow background */}
      <circle
        cx="0"
        cy="0"
        r="14"
        fill={`${statusColor}30`}
        style={{ filter: 'blur(4px)' }}
      />

      {/* Outer ring with glow */}
      <circle
        cx="0"
        cy="0"
        r="12"
        fill="rgba(15, 23, 42, 0.9)"
        stroke={statusColor}
        strokeWidth="2"
        style={{ filter: `drop-shadow(0 0 4px ${statusColor})` }}
      />

      {/* Inner gradient circle */}
      <circle
        cx="0"
        cy="0"
        r="8"
        fill={statusColor}
        style={{ filter: `drop-shadow(0 0 3px ${statusColor})` }}
      />

      {/* Robot icon - minimal and clean */}
      <g transform="translate(-4, -4)" fill="rgba(15, 23, 42, 0.9)">
        <rect x="1" y="0" width="6" height="5" rx="1" />
        <rect x="0" y="5" width="8" height="3" rx="0.5" />
        <circle cx="2" cy="2" r="1" fill={statusColor} />
        <circle cx="6" cy="2" r="1" fill={statusColor} />
      </g>

      {/* Robot name label */}
      <text
        x="0"
        y="26"
        textAnchor="middle"
        fontSize="8"
        fontFamily="monospace"
        fontWeight="500"
        fill="#94a3b8"
        style={{ textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}
      >
        {robot.name.length > 10 ? `${robot.name.substring(0, 10)}...` : robot.name}
      </text>

      {/* Battery indicator for low battery */}
      {robot.batteryLevel < 20 && (
        <g transform="translate(10, -14)">
          {/* Glow background */}
          <circle cx="6" cy="4" r="10" fill="#ef444430" style={{ filter: 'blur(3px)' }} />
          {/* Battery icon */}
          <rect
            x="0"
            y="0"
            width="12"
            height="8"
            rx="2"
            fill="#ef4444"
            stroke="rgba(15, 23, 42, 0.9)"
            strokeWidth="1"
            style={{ filter: 'drop-shadow(0 0 4px #ef4444)' }}
          />
          <rect x="12" y="2" width="2" height="4" rx="0.5" fill="#ef4444" />
          <text
            x="6"
            y="6"
            textAnchor="middle"
            fontSize="6"
            fill="white"
            fontWeight="bold"
            fontFamily="monospace"
          >
            !
          </text>
        </g>
      )}
    </g>
  );
}
