/**
 * @file pathCalculation.ts
 * @description Utility functions for calculating simulation paths
 * @feature command
 * @dependencies @/features/command/types/simulation.types
 */

import type {
  SimulationPoint,
  SimulationObstacle,
  SimulationPath,
  SimulationWaypoint,
} from '../types/simulation.types';
import { CANVAS_SIZE, DEFAULT_ROBOT_SPEED } from '../types/simulation.types';

// ============================================================================
// COORDINATE TRANSFORMATION
// ============================================================================

/**
 * Transform world coordinates to canvas coordinates.
 * World coordinates are in meters, canvas is fixed size.
 * Uses a simple scaling with padding.
 */
export function worldToCanvas(
  point: SimulationPoint,
  worldBounds: { minX: number; maxX: number; minY: number; maxY: number }
): SimulationPoint {
  const padding = 40; // Padding from edges
  const canvasWidth = CANVAS_SIZE.width - padding * 2;
  const canvasHeight = CANVAS_SIZE.height - padding * 2;

  const worldWidth = worldBounds.maxX - worldBounds.minX;
  const worldHeight = worldBounds.maxY - worldBounds.minY;

  // Avoid division by zero
  const scaleX = worldWidth > 0 ? canvasWidth / worldWidth : 1;
  const scaleY = worldHeight > 0 ? canvasHeight / worldHeight : 1;
  const scale = Math.min(scaleX, scaleY);

  return {
    x: padding + (point.x - worldBounds.minX) * scale,
    y: padding + (point.y - worldBounds.minY) * scale,
  };
}

/**
 * Calculate world bounds from start, destination, and obstacles.
 */
export function calculateWorldBounds(
  start: SimulationPoint,
  end: SimulationPoint,
  obstacles: SimulationObstacle[]
): { minX: number; maxX: number; minY: number; maxY: number } {
  const allPoints = [start, end, ...obstacles.map((o) => o.position)];

  const xs = allPoints.map((p) => p.x);
  const ys = allPoints.map((p) => p.y);

  const padding = 2; // World units padding
  return {
    minX: Math.min(...xs) - padding,
    maxX: Math.max(...xs) + padding,
    minY: Math.min(...ys) - padding,
    maxY: Math.max(...ys) + padding,
  };
}

// ============================================================================
// PATH CALCULATION
// ============================================================================

/**
 * Calculate distance between two points.
 */
export function distance(a: SimulationPoint, b: SimulationPoint): number {
  return Math.sqrt(Math.pow(b.x - a.x, 2) + Math.pow(b.y - a.y, 2));
}

/**
 * Calculate a control point offset to avoid an obstacle.
 */
function calculateObstacleAvoidanceOffset(
  midpoint: SimulationPoint,
  obstacles: SimulationObstacle[]
): SimulationPoint {
  if (obstacles.length === 0) {
    return { x: 0, y: 0 };
  }

  // Find the closest obstacle to the midpoint
  let closestObstacle = obstacles[0];
  let minDist = distance(midpoint, obstacles[0].position);

  for (const obstacle of obstacles) {
    const dist = distance(midpoint, obstacle.position);
    if (dist < minDist) {
      minDist = dist;
      closestObstacle = obstacle;
    }
  }

  // Calculate perpendicular offset direction
  const dx = midpoint.x - closestObstacle.position.x;
  const dy = midpoint.y - closestObstacle.position.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;

  // Offset magnitude based on obstacle size
  const offsetMagnitude = closestObstacle.size + 30;

  return {
    x: (dx / len) * offsetMagnitude,
    y: (dy / len) * offsetMagnitude,
  };
}

/**
 * Generate SVG path data from start to end, avoiding obstacles.
 */
export function calculatePathData(
  start: SimulationPoint,
  end: SimulationPoint,
  obstacles: SimulationObstacle[]
): string {
  // If no obstacles, use a slight curve for visual interest
  if (obstacles.length === 0) {
    const mid = {
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2 - 20, // Slight upward curve
    };
    return `M ${start.x} ${start.y} Q ${mid.x} ${mid.y} ${end.x} ${end.y}`;
  }

  // Calculate control point avoiding obstacles
  const mid = {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
  };
  const offset = calculateObstacleAvoidanceOffset(mid, obstacles);

  return `M ${start.x} ${start.y} Q ${mid.x + offset.x} ${mid.y + offset.y} ${end.x} ${end.y}`;
}

/**
 * Generate waypoints along a path.
 */
export function generateWaypoints(
  start: SimulationPoint,
  end: SimulationPoint,
  numIntermediate: number = 2
): SimulationWaypoint[] {
  const waypoints: SimulationWaypoint[] = [
    { position: start, type: 'start' },
  ];

  // Add intermediate waypoints
  for (let i = 1; i <= numIntermediate; i++) {
    const t = i / (numIntermediate + 1);
    waypoints.push({
      position: {
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t,
      },
      type: 'waypoint',
    });
  }

  waypoints.push({ position: end, type: 'destination' });

  return waypoints;
}

/**
 * Estimate path length (approximate for quadratic bezier).
 */
export function estimatePathLength(
  start: SimulationPoint,
  end: SimulationPoint,
  obstacles: SimulationObstacle[]
): number {
  // For straight line
  const directDistance = distance(start, end);

  // Add extra for curves around obstacles
  if (obstacles.length > 0) {
    return directDistance * 1.2; // 20% longer for avoidance path
  }

  return directDistance;
}

/**
 * Calculate estimated time of arrival.
 */
export function estimateETA(distanceMeters: number, speedMps: number = DEFAULT_ROBOT_SPEED): number {
  if (speedMps <= 0) return 0;
  return distanceMeters / speedMps;
}

/**
 * Format distance for display.
 */
export function formatDistance(meters: number): string {
  if (meters < 1) {
    return `${Math.round(meters * 100)}cm`;
  }
  return `${meters.toFixed(1)}m`;
}

/**
 * Format ETA for display.
 */
export function formatETA(seconds: number): string {
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

// ============================================================================
// FULL PATH GENERATION
// ============================================================================

/**
 * Generate complete simulation path with all data.
 */
export function generateSimulationPath(
  start: SimulationPoint,
  end: SimulationPoint,
  obstacles: SimulationObstacle[],
  speedMps: number = DEFAULT_ROBOT_SPEED
): SimulationPath {
  const pathData = calculatePathData(start, end, obstacles);
  const waypoints = generateWaypoints(start, end, 2);
  const pathDistance = estimatePathLength(start, end, obstacles);
  const eta = estimateETA(pathDistance, speedMps);

  return {
    pathData,
    waypoints,
    distance: pathDistance,
    eta,
  };
}

// ============================================================================
// OBSTACLE PARSING
// ============================================================================

/**
 * Parse obstacles from VLA warnings.
 */
export function parseObstaclesFromWarnings(
  warnings: string[] | undefined,
  start: SimulationPoint,
  end: SimulationPoint
): SimulationObstacle[] {
  if (!warnings || warnings.length === 0) {
    return [];
  }

  const obstacles: SimulationObstacle[] = [];
  let id = 0;

  for (const warning of warnings) {
    const lowerWarning = warning.toLowerCase();

    if (lowerWarning.includes('obstacle')) {
      // Place obstacle near the path midpoint, slightly offset
      const mid = {
        x: (start.x + end.x) / 2 + (Math.random() - 0.5) * 20,
        y: (start.y + end.y) / 2 + (Math.random() - 0.5) * 20,
      };
      obstacles.push({
        id: `obstacle-${id++}`,
        position: mid,
        size: 15,
        label: 'OBSTACLE',
        type: 'static',
      });
    } else if (lowerWarning.includes('zone') || lowerWarning.includes('restricted')) {
      // Place near destination
      const near = {
        x: end.x - 30,
        y: end.y - 20,
      };
      obstacles.push({
        id: `zone-${id++}`,
        position: near,
        size: 20,
        label: 'ZONE',
        type: 'static',
      });
    }
  }

  return obstacles;
}
