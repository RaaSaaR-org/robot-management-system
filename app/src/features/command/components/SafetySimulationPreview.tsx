/**
 * @file SafetySimulationPreview.tsx
 * @description Path preview before a command runs: start, target, obstacles and
 *              the planned path in 2D (SVG) or 3D (three.js), with distance, ETA
 *              and the safety class. Colours come from theme tokens (SIM_COLORS).
 *              Renders no heading — it sits inside the CommandBar.
 * @feature command
 */

import { useState } from 'react';
import { KeyValueList, Panel, SegmentedControl, StatusTag } from '@/shared/components/ui';
import { SafetySimulation3D } from './SafetySimulation3D';
import type { SimulationPoint, SimulationObstacle, SimulationSafetyStatus } from '../types/simulation.types';
import { CANVAS_SIZE, DEFAULT_ROBOT_SPEED } from '../types/simulation.types';
import { SAFETY_CLASSIFICATION_LABELS, SAFETY_CLASSIFICATION_TONE } from '../types/command.types';
import { generateSimulationPath, formatDistance, formatETA } from '../utils/pathCalculation';
import { SAFETY_STATUS_ROLE, SIM_COLORS } from '../utils/simColors';

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
  /** Command type for grip point visualization in 3D */
  commandType?: string;
  /** Additional class names */
  className?: string;
}

/** Robot marker travels the path; nothing moves when the viewer asks for reduced motion. */
const styles = `
  @keyframes simMoveRobot { from { offset-distance: 0%; } to { offset-distance: 100%; } }
  .sim-robot { animation: simMoveRobot 4s ease-in-out infinite; }
  @media (prefers-reduced-motion: reduce) { .sim-robot { animation: none; } }
`;

const LABEL_STYLE = { fontFamily: 'Inter, system-ui, sans-serif', fontSize: 11 } as const;

function Path2D({
  robotPosition,
  destination,
  obstacles,
  pathData,
  pathColor,
}: {
  robotPosition: SimulationPoint;
  destination: SimulationPoint;
  obstacles: SimulationObstacle[];
  pathData: string;
  pathColor: string;
}) {
  return (
    <div className="relative aspect-video overflow-hidden rounded-control border border-line-subtle bg-canvas">
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox={`0 0 ${CANVAS_SIZE.width} ${CANVAS_SIZE.height}`}
        role="img"
        aria-label="Planned path from the robot to the target"
      >
        <defs>
          <pattern id="simGrid" width="25" height="25" patternUnits="userSpaceOnUse">
            <path d="M 25 0 L 0 0 0 25" fill="none" stroke={SIM_COLORS.line} strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#simGrid)" />

        {obstacles.map(({ id, position, size, label }) => (
          <g key={id}>
            <circle cx={position.x} cy={position.y} r={size + 14} fill={SIM_COLORS.stopped} opacity={0.08} />
            <rect
              x={position.x - size / 2}
              y={position.y - size / 2}
              width={size}
              height={size}
              rx="3"
              fill={SIM_COLORS.panel}
              stroke={SIM_COLORS.stopped}
              strokeWidth="1.5"
              strokeDasharray="4 2"
            />
            <text x={position.x} y={position.y + size / 2 + 14} textAnchor="middle" fill={SIM_COLORS.stopped} style={LABEL_STYLE}>
              {label}
            </text>
          </g>
        ))}

        <path d={pathData} fill="none" stroke={pathColor} strokeWidth="2.5" strokeLinecap="round" strokeDasharray="6 4" />

        <circle cx={robotPosition.x} cy={robotPosition.y} r="6" fill="none" stroke={SIM_COLORS.muted} strokeWidth="1.5" />
        <text x={robotPosition.x} y={robotPosition.y + 20} textAnchor="middle" fill={SIM_COLORS.muted} style={LABEL_STYLE}>
          Start
        </text>

        <circle cx={destination.x} cy={destination.y} r="10" fill="none" stroke={SIM_COLORS.primary} strokeWidth="1.5" opacity={0.6} />
        <circle cx={destination.x} cy={destination.y} r="4" fill={SIM_COLORS.primary} />
        <text x={destination.x} y={destination.y + 24} textAnchor="middle" fill={SIM_COLORS.primary} style={LABEL_STYLE}>
          Target
        </text>

        <g className="sim-robot" style={{ offsetPath: `path('${pathData}')` }}>
          <circle r="8" fill={SIM_COLORS.primary} />
          <circle r="3" fill={SIM_COLORS.panel} />
        </g>
      </svg>
    </div>
  );
}

/**
 * Safety simulation preview for movement commands.
 *
 * @example
 * ```tsx
 * <SafetySimulationPreview robotPosition={p} destination={d} obstacles={o} safetyClassification="safe" isVisible />
 * ```
 */
export function SafetySimulationPreview({
  robotPosition,
  destination,
  obstacles = [],
  safetyClassification,
  speed = DEFAULT_ROBOT_SPEED,
  isVisible,
  commandType,
  className,
}: SafetySimulationPreviewProps) {
  const [view, setView] = useState<'2d' | '3d'>('2d');

  if (!destination || !isVisible) return null;

  const simulationPath = generateSimulationPath(robotPosition, destination, obstacles, speed);
  const pathColor = SIM_COLORS[SAFETY_STATUS_ROLE[safetyClassification]];

  return (
    <Panel variant="inset" padding="sm" className={className}>
      <style>{styles}</style>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-ink-primary">Path preview</span>
            <StatusTag tone="sim">Sim</StatusTag>
          </div>
          <SegmentedControl
            label="Preview view"
            size="sm"
            options={[
              { value: '2d', label: '2D' },
              { value: '3d', label: '3D' },
            ]}
            value={view}
            onChange={setView}
          />
        </div>

        {view === '3d' ? (
          <SafetySimulation3D
            robotPosition={robotPosition}
            destination={destination}
            obstacles={obstacles}
            safetyClassification={safetyClassification}
            speed={speed}
            commandType={commandType}
          />
        ) : (
          <Path2D
            robotPosition={robotPosition}
            destination={destination}
            obstacles={obstacles}
            pathData={simulationPath.pathData}
            pathColor={pathColor}
          />
        )}

        <div className="flex flex-wrap items-end justify-between gap-3">
          <KeyValueList
            columns={3}
            items={[
              { label: 'Distance', value: <span className="tabular-nums">{formatDistance(simulationPath.distance)}</span> },
              { label: 'ETA', value: <span className="tabular-nums">{formatETA(simulationPath.eta)}</span> },
              { label: 'Obstacles', value: obstacles.length > 0 ? `${obstacles.length} avoided` : 'Path clear' },
            ]}
            className="min-w-0 flex-1"
          />
          <StatusTag tone={SAFETY_CLASSIFICATION_TONE[safetyClassification]} dot>
            {SAFETY_CLASSIFICATION_LABELS[safetyClassification]}
          </StatusTag>
        </div>
      </div>
    </Panel>
  );
}
