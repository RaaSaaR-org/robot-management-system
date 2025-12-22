/**
 * @file useSimulation.ts
 * @description Hook for safety simulation preview state
 * @feature command
 * @dependencies @/features/command/types, @/features/command/utils, @/features/robots/hooks
 * @stateAccess useRobot (read)
 */

import { useMemo } from 'react';
import { useRobot } from '@/features/robots/hooks';
import type { CommandInterpretation } from '../types/command.types';
import type {
  SimulationState,
  SimulationPoint,
  SimulationObstacle,
} from '../types/simulation.types';
import {
  DEFAULT_ROBOT_SPEED,
  MOVEMENT_COMMAND_TYPES,
} from '../types/simulation.types';
import {
  worldToCanvas,
  calculateWorldBounds,
  generateSimulationPath,
  parseObstaclesFromWarnings,
} from '../utils/pathCalculation';

// ============================================================================
// TYPES
// ============================================================================

export interface UseSimulationReturn {
  /** Full simulation state */
  simulation: SimulationState;
  /** Whether simulation should be shown */
  shouldShowSimulation: boolean;
  /** Canvas-transformed robot position */
  canvasRobotPosition: SimulationPoint;
  /** Canvas-transformed destination */
  canvasDestination: SimulationPoint | null;
  /** Canvas-transformed obstacles */
  canvasObstacles: SimulationObstacle[];
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook for safety simulation preview.
 * Combines robot position, command interpretation, and telemetry
 * to generate simulation state for visualization.
 *
 * @param robotId - Robot ID to get position from
 * @param interpretation - Current command interpretation (null if none)
 *
 * @example
 * ```tsx
 * function CommandWithSimulation({ robotId }: { robotId: string }) {
 *   const { interpretation } = useCommand();
 *   const { simulation, shouldShowSimulation } = useSimulation(robotId, interpretation);
 *
 *   return (
 *     <>
 *       <CommandPreview interpretation={interpretation} />
 *       {shouldShowSimulation && (
 *         <SafetySimulationPreview
 *           robotPosition={simulation.robotPosition}
 *           destination={simulation.destination}
 *           obstacles={simulation.obstacles}
 *           safetyClassification={simulation.safetyStatus}
 *         />
 *       )}
 *     </>
 *   );
 * }
 * ```
 */
export function useSimulation(
  robotId: string,
  interpretation: CommandInterpretation | null
): UseSimulationReturn {
  const { robot, telemetry } = useRobot(robotId);

  // Get robot position from robot data
  const robotPosition: SimulationPoint = useMemo(() => {
    if (robot?.location) {
      return {
        x: robot.location.x,
        y: robot.location.y,
      };
    }
    // Default position if robot not loaded
    return { x: 0, y: 0 };
  }, [robot?.location]);

  // Get destination from interpretation
  const destination: SimulationPoint | null = useMemo(() => {
    if (interpretation?.parameters?.destination) {
      return {
        x: interpretation.parameters.destination.x,
        y: interpretation.parameters.destination.y,
      };
    }
    return null;
  }, [interpretation?.parameters?.destination]);

  // Parse obstacles from warnings
  const obstacles: SimulationObstacle[] = useMemo(() => {
    if (!destination) return [];
    return parseObstaclesFromWarnings(
      interpretation?.warnings,
      robotPosition,
      destination
    );
  }, [interpretation?.warnings, robotPosition, destination]);

  // Get speed from telemetry or use default
  const speed = telemetry?.speed ?? DEFAULT_ROBOT_SPEED;

  // Determine if simulation should be shown
  const shouldShowSimulation = useMemo(() => {
    if (!interpretation) return false;
    if (!destination) return false;

    // Only show for movement commands
    return MOVEMENT_COMMAND_TYPES.includes(
      interpretation.commandType as (typeof MOVEMENT_COMMAND_TYPES)[number]
    );
  }, [interpretation, destination]);

  // Calculate world bounds and canvas transformations
  const worldBounds = useMemo(() => {
    if (!destination) {
      return {
        minX: robotPosition.x - 10,
        maxX: robotPosition.x + 10,
        minY: robotPosition.y - 10,
        maxY: robotPosition.y + 10,
      };
    }
    return calculateWorldBounds(robotPosition, destination, obstacles);
  }, [robotPosition, destination, obstacles]);

  // Transform to canvas coordinates
  const canvasRobotPosition = useMemo(
    () => worldToCanvas(robotPosition, worldBounds),
    [robotPosition, worldBounds]
  );

  const canvasDestination = useMemo(
    () => (destination ? worldToCanvas(destination, worldBounds) : null),
    [destination, worldBounds]
  );

  const canvasObstacles = useMemo(
    () =>
      obstacles.map((obs) => ({
        ...obs,
        position: worldToCanvas(obs.position, worldBounds),
      })),
    [obstacles, worldBounds]
  );

  // Generate path
  const path = useMemo(() => {
    if (!canvasDestination) return null;
    return generateSimulationPath(
      canvasRobotPosition,
      canvasDestination,
      canvasObstacles,
      speed
    );
  }, [canvasRobotPosition, canvasDestination, canvasObstacles, speed]);

  // Build full simulation state
  const simulation: SimulationState = useMemo(
    () => ({
      robotPosition,
      robotHeading: robot?.location?.heading ?? 0,
      destination,
      path,
      obstacles,
      safetyStatus: interpretation?.safetyClassification ?? 'safe',
      isAnimating: shouldShowSimulation,
    }),
    [robotPosition, robot?.location?.heading, destination, path, obstacles, interpretation?.safetyClassification, shouldShowSimulation]
  );

  return {
    simulation,
    shouldShowSimulation,
    canvasRobotPosition,
    canvasDestination,
    canvasObstacles,
  };
}
