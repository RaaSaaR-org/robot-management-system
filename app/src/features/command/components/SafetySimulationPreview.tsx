/**
 * @file SafetySimulationPreview.tsx
 * @description Safety simulation preview component for visualizing robot paths
 * @feature command
 * @dependencies @/shared/utils/cn, @/features/command/types, @/features/command/utils
 */

import { cn } from '@/shared/utils/cn';
import type {
  SimulationPoint,
  SimulationObstacle,
  SimulationSafetyStatus,
} from '../types/simulation.types';
import {
  CANVAS_SIZE,
  SAFETY_STATUS_COLORS,
  DEFAULT_ROBOT_SPEED,
} from '../types/simulation.types';
import {
  generateSimulationPath,
  formatDistance,
  formatETA,
} from '../utils/pathCalculation';

// ============================================================================
// TYPES
// ============================================================================

export interface SafetySimulationPreviewProps {
  /** Robot's current position (canvas coordinates) */
  robotPosition: SimulationPoint;
  /** Command destination (canvas coordinates, null hides simulation) */
  destination: SimulationPoint | null;
  /** Obstacles to display (canvas coordinates) */
  obstacles?: SimulationObstacle[];
  /** Safety classification from interpretation */
  safetyClassification: SimulationSafetyStatus;
  /** Robot speed in m/s (for ETA calculation) */
  speed?: number;
  /** Whether the simulation is visible */
  isVisible: boolean;
  /** Additional class names */
  className?: string;
}

// ============================================================================
// STYLES
// ============================================================================

const styles = `
  @keyframes drawPath {
    0% { stroke-dashoffset: 300; }
    100% { stroke-dashoffset: 0; }
  }

  @keyframes moveRobot {
    0% { offset-distance: 0%; }
    100% { offset-distance: 100%; }
  }

  @keyframes radarSweep {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  @keyframes pulseRing {
    0% { r: 12; opacity: 1; }
    100% { r: 30; opacity: 0; }
  }

  @keyframes scanLine {
    0% { top: 0; }
    100% { top: 100%; }
  }

  @keyframes gridPulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
  }

  @keyframes dataPulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }

  @keyframes countdown {
    from { width: 100%; }
    to { width: 0%; }
  }

  @keyframes fadeInUp {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
`;

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

/** Grid background */
function GridBackground() {
  return (
    <div
      className="absolute inset-0"
      style={{
        backgroundImage:
          'linear-gradient(to right, rgba(42, 95, 255, 0.15) 1px, transparent 1px), linear-gradient(to bottom, rgba(42, 95, 255, 0.15) 1px, transparent 1px)',
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
      className="absolute inset-x-0 h-8 bg-gradient-to-b from-turquoise/20 via-turquoise/10 to-transparent pointer-events-none"
      style={{ animation: 'scanLine 2.5s ease-in-out infinite' }}
    />
  );
}

/** SVG definitions for gradients and filters */
function SvgDefs() {
  return (
    <defs>
      {/* Path gradient */}
      <linearGradient id="simPathGradient" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#2A5FFF" />
        <stop offset="100%" stopColor="#18E4C3" />
      </linearGradient>
      {/* Glow filter */}
      <filter id="simGlow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="3" result="coloredBlur" />
        <feMerge>
          <feMergeNode in="coloredBlur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      {/* Obstacle zone gradient */}
      <radialGradient id="simDangerZone" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#EF4444" stopOpacity="0.3" />
        <stop offset="100%" stopColor="#EF4444" stopOpacity="0" />
      </radialGradient>
    </defs>
  );
}

/** Obstacle with danger zone */
function ObstacleMarker({ obstacle }: { obstacle: SimulationObstacle }) {
  const { position, size, label } = obstacle;
  return (
    <g>
      <circle cx={position.x} cy={position.y} r={size + 20} fill="url(#simDangerZone)" />
      <rect
        x={position.x - size / 2}
        y={position.y - size / 2}
        width={size}
        height={size}
        rx="4"
        fill="#374151"
        stroke="#EF4444"
        strokeWidth="2"
        strokeDasharray="4 2"
      />
      <text
        x={position.x}
        y={position.y + size / 2 + 15}
        textAnchor="middle"
        fill="#EF4444"
        fontSize="8"
        fontFamily="monospace"
      >
        {label}
      </text>
    </g>
  );
}

/** Animated path line */
function PathLine({ pathData }: { pathData: string }) {
  return (
    <path
      d={pathData}
      fill="none"
      stroke="url(#simPathGradient)"
      strokeWidth="3"
      strokeLinecap="round"
      filter="url(#simGlow)"
      strokeDasharray="300"
      style={{ animation: 'drawPath 3s ease-out infinite' }}
    />
  );
}

/** Waypoint markers */
function Waypoints({
  start,
  end,
}: {
  start: SimulationPoint;
  end: SimulationPoint;
}) {
  // Generate intermediate waypoints
  const mid1 = {
    x: start.x + (end.x - start.x) * 0.33,
    y: start.y + (end.y - start.y) * 0.33 - 10,
  };
  const mid2 = {
    x: start.x + (end.x - start.x) * 0.66,
    y: start.y + (end.y - start.y) * 0.66 - 10,
  };

  return (
    <g>
      <circle cx={mid1.x} cy={mid1.y} r="4" fill="#2A5FFF" opacity="0.6" />
      <circle cx={mid2.x} cy={mid2.y} r="4" fill="#2A5FFF" opacity="0.6" />
    </g>
  );
}

/** Start position marker */
function StartMarker({ position }: { position: SimulationPoint }) {
  return (
    <g>
      <circle
        cx={position.x}
        cy={position.y}
        r="6"
        fill="none"
        stroke="#2A5FFF"
        strokeWidth="2"
        strokeDasharray="3 2"
      />
      <text
        x={position.x}
        y={position.y + 20}
        textAnchor="middle"
        fill="#2A5FFF"
        fontSize="8"
        fontFamily="monospace"
      >
        START
      </text>
    </g>
  );
}

/** Target destination marker */
function TargetMarker({ position }: { position: SimulationPoint }) {
  return (
    <g>
      <circle cx={position.x} cy={position.y} r="12" fill="none" stroke="#18E4C3" strokeWidth="2" opacity="0.5" />
      <circle cx={position.x} cy={position.y} r="8" fill="none" stroke="#18E4C3" strokeWidth="2" opacity="0.7" />
      <circle cx={position.x} cy={position.y} r="4" fill="#18E4C3" />
      <text
        x={position.x}
        y={position.y + 25}
        textAnchor="middle"
        fill="#18E4C3"
        fontSize="8"
        fontFamily="monospace"
      >
        TARGET
      </text>
    </g>
  );
}

/** Animated robot on path */
function AnimatedRobot({ pathData }: { pathData: string }) {
  return (
    <g
      style={{
        offsetPath: `path('${pathData}')`,
        animation: 'moveRobot 4s ease-in-out infinite',
      }}
    >
      {/* Radar sweep from robot */}
      <g style={{ animation: 'radarSweep 2s linear infinite' }}>
        <path d="M 0 0 L 25 -15 A 30 30 0 0 1 25 15 Z" fill="rgba(24, 228, 195, 0.15)" />
      </g>
      {/* Pulse rings */}
      <circle
        cx="0"
        cy="0"
        r="12"
        fill="none"
        stroke="#18E4C3"
        strokeWidth="1"
        style={{ animation: 'pulseRing 2s ease-out infinite' }}
      />
      <circle
        cx="0"
        cy="0"
        r="12"
        fill="none"
        stroke="#18E4C3"
        strokeWidth="1"
        style={{ animation: 'pulseRing 2s ease-out infinite 0.5s' }}
      />
      {/* Robot body */}
      <circle cx="0" cy="0" r="14" fill="#2A5FFF" />
      <circle cx="0" cy="0" r="10" fill="#1a4ad4" />
      {/* Robot icon */}
      <rect x="-5" y="-5" width="10" height="10" rx="2" fill="white" opacity="0.9" />
      <circle cx="-2" cy="-2" r="1.5" fill="#2A5FFF" />
      <circle cx="2" cy="-2" r="1.5" fill="#2A5FFF" />
      <rect x="-3" y="1" width="6" height="2" rx="1" fill="#2A5FFF" />
    </g>
  );
}

/** Data overlay */
function DataOverlay({ distance, eta }: { distance: number; eta: number }) {
  return (
    <div className="absolute top-3 left-3 flex flex-col gap-1">
      <div className="flex items-center gap-2 text-xs font-mono">
        <span className="text-theme-muted">DIST:</span>
        <span className="text-turquoise" style={{ animation: 'dataPulse 1s ease-in-out infinite' }}>
          {formatDistance(distance)}
        </span>
      </div>
      <div className="flex items-center gap-2 text-xs font-mono">
        <span className="text-theme-muted">ETA:</span>
        <span className="text-cobalt-300" style={{ animation: 'dataPulse 1s ease-in-out infinite 0.3s' }}>
          {formatETA(eta)}
        </span>
      </div>
    </div>
  );
}

/** Collision warning badge */
function CollisionWarning({ obstacleCount }: { obstacleCount: number }) {
  if (obstacleCount === 0) return null;

  return (
    <div className="absolute top-3 right-3 flex items-center gap-2 px-2 py-1 rounded bg-yellow-500/20 border border-yellow-500/30">
      <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
      <span className="text-yellow-400 text-xs font-mono">REROUTED</span>
    </div>
  );
}

/** Safety status badges */
function SafetyBadges({
  safetyStatus,
  obstacleCount,
}: {
  safetyStatus: SimulationSafetyStatus;
  obstacleCount: number;
}) {
  const colors = SAFETY_STATUS_COLORS[safetyStatus];

  return (
    <div className="px-4 pb-4 flex flex-wrap gap-2">
      <span
        className="px-3 py-1.5 rounded-full bg-green-500/20 text-green-400 text-xs font-medium flex items-center gap-1.5"
        style={{ animation: 'fadeInUp 0.5s ease-out forwards', animationDelay: '0.5s', opacity: 0 }}
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
        </svg>
        Path Clear
      </span>
      {obstacleCount > 0 && (
        <span
          className="px-3 py-1.5 rounded-full bg-yellow-500/20 text-yellow-400 text-xs font-medium flex items-center gap-1.5"
          style={{ animation: 'fadeInUp 0.5s ease-out forwards', animationDelay: '0.8s', opacity: 0 }}
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 9v2m0 4h.01" />
          </svg>
          {obstacleCount} Avoided
        </span>
      )}
      <span
        className="px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5"
        style={{
          backgroundColor: colors.bg,
          color: colors.primary,
          animation: 'fadeInUp 0.5s ease-out forwards',
          animationDelay: '1.1s',
          opacity: 0,
        }}
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={3}
            d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
          />
        </svg>
        {safetyStatus === 'safe' && 'Safe to Execute'}
        {safetyStatus === 'caution' && 'Proceed with Caution'}
        {safetyStatus === 'dangerous' && 'High Risk'}
      </span>
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

/**
 * Safety simulation preview component.
 * Visualizes robot path from current position to destination,
 * showing obstacles and safety classification.
 *
 * @example
 * ```tsx
 * function CommandWithSimulation({ robotId }: { robotId: string }) {
 *   const { interpretation } = useCommand();
 *   const { canvasRobotPosition, canvasDestination, canvasObstacles, shouldShowSimulation } =
 *     useSimulation(robotId, interpretation);
 *
 *   if (!shouldShowSimulation) return null;
 *
 *   return (
 *     <SafetySimulationPreview
 *       robotPosition={canvasRobotPosition}
 *       destination={canvasDestination}
 *       obstacles={canvasObstacles}
 *       safetyClassification={interpretation.safetyClassification}
 *       isVisible={true}
 *     />
 *   );
 * }
 * ```
 */
export function SafetySimulationPreview({
  robotPosition,
  destination,
  obstacles = [],
  safetyClassification,
  speed = DEFAULT_ROBOT_SPEED,
  isVisible,
  className,
}: SafetySimulationPreviewProps) {
  // Don't render if no destination or not visible
  if (!destination || !isVisible) return null;

  // Generate path data
  const simulationPath = generateSimulationPath(robotPosition, destination, obstacles, speed);

  return (
    <div className={cn('bg-theme-card rounded-xl border border-theme overflow-hidden', className)}>
      {/* Inject styles */}
      <style>{styles}</style>

      {/* Header */}
      <div className="p-4 border-b border-theme flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-3 h-3 rounded-full bg-turquoise" />
            <div className="absolute inset-0 w-3 h-3 rounded-full bg-turquoise animate-ping" />
          </div>
          <span className="text-theme-secondary text-sm font-mono">Safety Preview Active</span>
        </div>
        {/* Animated countdown */}
        <div className="flex items-center gap-3">
          <div className="w-24 h-1.5 bg-surface-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-turquoise to-cobalt rounded-full"
              style={{ animation: 'countdown 4s linear infinite' }}
            />
          </div>
          <span className="text-turquoise text-sm font-mono tabular-nums">SCANNING</span>
        </div>
      </div>

      <div className="p-4">
        {/* Visualization area */}
        <div className="aspect-video section-primary rounded-xl relative overflow-hidden">
          <GridBackground />
          <ScanLine />

          {/* SVG for paths and animations */}
          <svg
            className="absolute inset-0 w-full h-full"
            viewBox={`0 0 ${CANVAS_SIZE.width} ${CANVAS_SIZE.height}`}
          >
            <SvgDefs />

            {/* Obstacles */}
            {obstacles.map((obstacle) => (
              <ObstacleMarker key={obstacle.id} obstacle={obstacle} />
            ))}

            {/* Animated path */}
            <PathLine pathData={simulationPath.pathData} />

            {/* Waypoints */}
            <Waypoints start={robotPosition} end={destination} />

            {/* Start marker */}
            <StartMarker position={robotPosition} />

            {/* Target marker */}
            <TargetMarker position={destination} />

            {/* Animated robot */}
            <AnimatedRobot pathData={simulationPath.pathData} />
          </svg>

          {/* Data overlay */}
          <DataOverlay distance={simulationPath.distance} eta={simulationPath.eta} />

          {/* Collision warning */}
          <CollisionWarning obstacleCount={obstacles.length} />
        </div>
      </div>

      {/* Safety badges */}
      <SafetyBadges safetyStatus={safetyClassification} obstacleCount={obstacles.length} />
    </div>
  );
}
