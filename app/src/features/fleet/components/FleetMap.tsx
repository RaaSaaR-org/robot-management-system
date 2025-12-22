/**
 * @file FleetMap.tsx
 * @description Futuristic SVG-based fleet map component for visualizing robot positions
 * @feature fleet
 * @dependencies @/shared/utils/cn, @/features/fleet/types
 */

import { useState, useMemo, useCallback } from 'react';
import { cn } from '@/shared/utils/cn';
import type { FleetMapProps, RobotMapMarker } from '../types/fleet.types';
import { MAP_CANVAS_SIZE, MOCK_ZONES } from '../types/fleet.types';
import { RobotMarker } from './RobotMarker';
import { ZoneOverlay } from './ZoneOverlay';

// ============================================================================
// CONSTANTS
// ============================================================================

const PADDING = 40;
const SCALE = 10; // pixels per unit

// Status colors for legend (matching futuristic theme)
const STATUS_COLORS = {
  online: '#18E4C3',   // turquoise
  busy: '#3b82f6',     // blue
  charging: '#eab308', // yellow
  error: '#ef4444',    // red
  offline: '#6b7280',  // gray
} as const;

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

/** SVG Definitions for gradients and filters */
function SVGDefs() {
  return (
    <defs>
      {/* Path gradient cobalt → turquoise */}
      <linearGradient id="fleetPathGradient" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#2A5FFF" />
        <stop offset="100%" stopColor="#18E4C3" />
      </linearGradient>

      {/* Glow filter */}
      <filter id="fleetGlow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="3" result="coloredBlur" />
        <feMerge>
          <feMergeNode in="coloredBlur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>

      {/* Subtle glow for zones */}
      <filter id="zoneGlow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="2" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>

      {/* Grid pattern */}
      <pattern id="fleetGrid" width="32" height="32" patternUnits="userSpaceOnUse">
        <path
          d="M 32 0 L 0 0 0 32"
          fill="none"
          stroke="rgba(42, 95, 255, 0.2)"
          strokeWidth="0.5"
        />
      </pattern>
    </defs>
  );
}

/** Animated grid background overlay */
function AnimatedGrid() {
  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{
        backgroundImage:
          'linear-gradient(to right, rgba(42, 95, 255, 0.12) 1px, transparent 1px), linear-gradient(to bottom, rgba(42, 95, 255, 0.12) 1px, transparent 1px)',
        backgroundSize: '32px 32px',
        animation: 'gridPulse 3s ease-in-out infinite',
      }}
    />
  );
}

/** Scan line effect */
function ScanLine() {
  return (
    <div
      className="absolute inset-x-0 h-16 bg-gradient-to-b from-turquoise/15 via-turquoise/5 to-transparent pointer-events-none"
      style={{ animation: 'scanLine 3s ease-in-out infinite' }}
    />
  );
}

/** Floor selector tabs */
function FloorSelector({
  floors,
  selectedFloor,
  onFloorChange,
}: {
  floors: string[];
  selectedFloor: string;
  onFloorChange: (floor: string) => void;
}) {
  return (
    <div className="flex gap-1">
      {floors.map((floor) => (
        <button
          key={floor}
          onClick={() => onFloorChange(floor)}
          className={cn(
            'px-3 py-1 text-xs font-mono rounded transition-all',
            selectedFloor === floor
              ? 'bg-cobalt text-white'
              : 'bg-surface-700/50 text-theme-tertiary hover:bg-surface-600/50 hover:text-theme-secondary'
          )}
        >
          F{floor}
        </button>
      ))}
    </div>
  );
}

/** Map legend with futuristic styling */
function MapLegend() {
  const statuses = [
    { status: 'online', label: 'ONLINE' },
    { status: 'busy', label: 'BUSY' },
    { status: 'charging', label: 'CHARGING' },
    { status: 'error', label: 'ERROR' },
    { status: 'offline', label: 'OFFLINE' },
  ] as const;

  return (
    <div className="flex flex-wrap gap-3 text-xs font-mono">
      {statuses.map(({ status, label }) => (
        <div key={status} className="flex items-center gap-1.5">
          <div
            className="w-2 h-2 rounded-full"
            style={{
              backgroundColor: STATUS_COLORS[status],
              boxShadow: `0 0 6px ${STATUS_COLORS[status]}60`,
            }}
          />
          <span className="text-theme-muted">{label}</span>
        </div>
      ))}
    </div>
  );
}

/** Robot info popup with dark theme */
function RobotPopup({
  robot,
  position,
  onClose,
  onViewDetails,
}: {
  robot: RobotMapMarker;
  position: { x: number; y: number };
  onClose: () => void;
  onViewDetails: () => void;
}) {
  const statusColor = STATUS_COLORS[robot.status as keyof typeof STATUS_COLORS] || STATUS_COLORS.offline;

  return (
    <g transform={`translate(${position.x + 20}, ${position.y - 10})`}>
      {/* Background with glow - expanded height for button */}
      <rect
        x="0"
        y="0"
        width="140"
        height="95"
        rx="8"
        fill="rgba(15, 23, 42, 0.95)"
        stroke="rgba(42, 95, 255, 0.3)"
        strokeWidth="1"
        filter="url(#zoneGlow)"
      />
      {/* Accent line */}
      <rect x="0" y="0" width="3" height="95" rx="1.5" fill="url(#fleetPathGradient)" />

      {/* Close button */}
      <g
        transform="translate(122, 8)"
        className="cursor-pointer"
        onClick={onClose}
        role="button"
        tabIndex={0}
      >
        <circle cx="6" cy="6" r="8" fill="rgba(255,255,255,0.1)" />
        <path d="M4 4 L8 8 M8 4 L4 8" stroke="#6b7280" strokeWidth="1.5" strokeLinecap="round" />
      </g>

      {/* Content */}
      <text x="12" y="22" fontSize="11" fontWeight="600" fill="#f8fafc" fontFamily="monospace">
        {robot.name}
      </text>
      <g transform="translate(12, 32)">
        <circle cx="4" cy="4" r="3" fill={statusColor} style={{ filter: `drop-shadow(0 0 3px ${statusColor})` }} />
        <text x="12" y="7" fontSize="9" fill="#94a3b8" fontFamily="monospace">
          {robot.status.toUpperCase()}
        </text>
      </g>
      <text x="12" y="56" fontSize="9" fill="#64748b" fontFamily="monospace">
        BAT: {robot.batteryLevel}%
      </text>
      <rect
        x="60"
        y="49"
        width="70"
        height="4"
        rx="2"
        fill="rgba(255,255,255,0.1)"
      />
      <rect
        x="60"
        y="49"
        width={Math.max(0, Math.min(70, robot.batteryLevel * 0.7))}
        height="4"
        rx="2"
        fill={robot.batteryLevel > 20 ? '#18E4C3' : '#ef4444'}
      />

      {/* View Details Button */}
      <g
        transform="translate(12, 68)"
        className="cursor-pointer"
        onClick={onViewDetails}
        role="button"
        tabIndex={0}
      >
        <rect
          x="0"
          y="0"
          width="116"
          height="20"
          rx="4"
          fill="#2A5FFF"
          className="transition-all"
          style={{ filter: 'drop-shadow(0 0 4px rgba(42, 95, 255, 0.5))' }}
        />
        <text
          x="58"
          y="14"
          textAnchor="middle"
          fontSize="9"
          fontWeight="600"
          fill="white"
          fontFamily="monospace"
        >
          VIEW DETAILS →
        </text>
      </g>
    </g>
  );
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Futuristic SVG-based fleet map showing robot positions on a facility grid.
 *
 * @example
 * ```tsx
 * function FleetOverview() {
 *   const { robotMarkers, floors } = useFleetStatus();
 *   const [floor, setFloor] = useState('1');
 *
 *   return (
 *     <FleetMap
 *       robots={robotMarkers}
 *       selectedFloor={floor}
 *       onFloorChange={setFloor}
 *       onRobotClick={(id) => navigate(`/robots/${id}`)}
 *     />
 *   );
 * }
 * ```
 */
export function FleetMap({
  robots,
  zones = MOCK_ZONES,
  selectedFloor,
  onFloorChange,
  onRobotClick,
  className,
}: FleetMapProps) {
  const [selectedRobotId, setSelectedRobotId] = useState<string | null>(null);

  // Get unique floors from robots
  const floors = useMemo(() => {
    const floorSet = new Set(robots.map((r) => r.floor));
    return Array.from(floorSet).sort();
  }, [robots]);

  // Filter robots by selected floor
  const filteredRobots = useMemo(() => {
    return robots.filter((r) => r.floor === selectedFloor);
  }, [robots, selectedFloor]);

  // Filter zones by selected floor
  const filteredZones = useMemo(() => {
    return zones.filter((z) => z.floor === selectedFloor);
  }, [zones, selectedFloor]);

  // Calculate bounds for positioning
  const bounds = useMemo(() => {
    if (filteredRobots.length === 0 && filteredZones.length === 0) {
      return { minX: 0, maxX: 50, minY: 0, maxY: 35 };
    }

    const allX = [
      ...filteredRobots.map((r) => r.position.x),
      ...filteredZones.flatMap((z) => [z.bounds.x, z.bounds.x + z.bounds.width]),
    ];
    const allY = [
      ...filteredRobots.map((r) => r.position.y),
      ...filteredZones.flatMap((z) => [z.bounds.y, z.bounds.y + z.bounds.height]),
    ];

    return {
      minX: Math.min(...allX, 0),
      maxX: Math.max(...allX, 50),
      minY: Math.min(...allY, 0),
      maxY: Math.max(...allY, 35),
    };
  }, [filteredRobots, filteredZones]);

  // Transform world coordinates to canvas coordinates
  const transformPoint = useCallback(
    (x: number, y: number) => ({
      x: PADDING + (x - bounds.minX) * SCALE,
      y: PADDING + (y - bounds.minY) * SCALE,
    }),
    [bounds]
  );

  // Get selected robot
  const selectedRobot = useMemo(() => {
    return filteredRobots.find((r) => r.robotId === selectedRobotId);
  }, [filteredRobots, selectedRobotId]);

  // Handle robot click - shows popup, navigation happens via "View Details" button
  const handleRobotClick = useCallback(
    (robotId: string) => {
      if (selectedRobotId === robotId) {
        setSelectedRobotId(null);
      } else {
        setSelectedRobotId(robotId);
      }
    },
    [selectedRobotId]
  );

  // Close popup
  const handleClosePopup = useCallback(() => {
    setSelectedRobotId(null);
  }, []);

  // Canvas dimensions
  const canvasWidth = (bounds.maxX - bounds.minX) * SCALE + PADDING * 2;
  const canvasHeight = (bounds.maxY - bounds.minY) * SCALE + PADDING * 2;

  // Count robots by status
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const robot of filteredRobots) {
      counts[robot.status] = (counts[robot.status] || 0) + 1;
    }
    return counts;
  }, [filteredRobots]);

  return (
    <div className={cn('section-primary rounded-2xl border border-cobalt/20 overflow-hidden', className)}>
      {/* Header */}
      <div className="p-4 border-b border-cobalt/10 flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <h3 className="text-lg font-semibold text-theme-primary font-mono">FLEET MAP</h3>
          {/* Live indicator */}
          <div className="flex items-center gap-2">
            <div className="relative">
              <div className="w-2 h-2 rounded-full bg-turquoise" />
              <div className="absolute inset-0 w-2 h-2 rounded-full bg-turquoise animate-ping" />
            </div>
            <span className="text-turquoise text-xs font-mono">LIVE</span>
          </div>
          {floors.length > 1 && (
            <FloorSelector
              floors={floors.length > 0 ? floors : ['1', '2']}
              selectedFloor={selectedFloor}
              onFloorChange={onFloorChange}
            />
          )}
        </div>
        <MapLegend />
      </div>

      {/* Map canvas */}
      <div className="relative overflow-hidden">
        {/* Animated grid overlay */}
        <AnimatedGrid />

        {/* Scan line effect */}
        <ScanLine />

        {/* SVG Map */}
        <div className="p-4 relative z-10">
          <div className="section-primary rounded-xl border border-cobalt/20 overflow-hidden relative">
            <svg
              width="100%"
              height="100%"
              viewBox={`0 0 ${Math.max(canvasWidth, MAP_CANVAS_SIZE.width)} ${Math.max(canvasHeight, MAP_CANVAS_SIZE.height)}`}
              className="min-h-[320px]"
            >
              <SVGDefs />

              {/* Grid fill */}
              <rect x="0" y="0" width="100%" height="100%" fill="url(#fleetGrid)" />

              {/* Zone overlays */}
              <ZoneOverlay
                zones={filteredZones}
                scale={SCALE}
                offset={{ x: PADDING - bounds.minX * SCALE, y: PADDING - bounds.minY * SCALE }}
              />

              {/* Robot markers */}
              {filteredRobots.map((robot) => {
                const pos = transformPoint(robot.position.x, robot.position.y);
                return (
                  <RobotMarker
                    key={robot.robotId}
                    robot={robot}
                    position={pos}
                    isSelected={robot.robotId === selectedRobotId}
                    onClick={() => handleRobotClick(robot.robotId)}
                  />
                );
              })}

              {/* Selected robot popup */}
              {selectedRobot && (
                <RobotPopup
                  robot={selectedRobot}
                  position={transformPoint(selectedRobot.position.x, selectedRobot.position.y)}
                  onClose={handleClosePopup}
                  onViewDetails={() => {
                    onRobotClick?.(selectedRobot.robotId);
                  }}
                />
              )}
            </svg>

            {/* Data overlay - bottom left */}
            <div className="absolute bottom-3 left-3 flex flex-col gap-1 font-mono text-xs">
              <div className="flex items-center gap-2">
                <span className="text-theme-muted">UNITS:</span>
                <span className="text-turquoise">{filteredRobots.length}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-theme-muted">ACTIVE:</span>
                <span className="text-cobalt-300">{statusCounts['busy'] || 0}</span>
              </div>
            </div>

            {/* Floor indicator - bottom right */}
            <div className="absolute bottom-3 right-3 font-mono text-xs">
              <span className="text-theme-muted">FLOOR </span>
              <span className="text-turquoise font-bold">{selectedFloor}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
