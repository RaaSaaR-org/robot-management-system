/**
 * @file markerClustering.ts
 * @description Spatial clustering utility for fleet map robot markers
 * @feature fleet
 */

// ============================================================================
// TYPES
// ============================================================================

/** Minimal robot marker data needed for clustering */
export interface RobotMarker {
  id: string;
  x: number;
  y: number;
  name: string;
  status: string;
}

/** A cluster of one or more robot markers */
export interface Cluster {
  /** Centroid X coordinate (average of all contained robots) */
  x: number;
  /** Centroid Y coordinate (average of all contained robots) */
  y: number;
  /** Robots in this cluster */
  robots: RobotMarker[];
}

// ============================================================================
// CLUSTERING
// ============================================================================

/**
 * Cluster robots that are within `threshold` units of each other.
 *
 * Uses a greedy single-pass algorithm:
 * 1. For each robot, find the nearest existing cluster within `threshold`.
 * 2. If found, add the robot to that cluster and update the centroid.
 * 3. Otherwise, create a new cluster.
 *
 * @param robots - Array of robot markers with positions
 * @param threshold - Distance threshold for grouping (default: 20)
 * @returns Array of clusters, each containing one or more robots
 */
export function clusterRobots(robots: RobotMarker[], threshold = 20): Cluster[] {
  const clusters: Cluster[] = [];

  for (const robot of robots) {
    let nearestCluster: Cluster | null = null;
    let nearestDist = Infinity;

    for (const cluster of clusters) {
      const dx = cluster.x - robot.x;
      const dy = cluster.y - robot.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < threshold && dist < nearestDist) {
        nearestCluster = cluster;
        nearestDist = dist;
      }
    }

    if (nearestCluster) {
      nearestCluster.robots.push(robot);
      // Recompute centroid
      const count = nearestCluster.robots.length;
      nearestCluster.x =
        nearestCluster.robots.reduce((sum, r) => sum + r.x, 0) / count;
      nearestCluster.y =
        nearestCluster.robots.reduce((sum, r) => sum + r.y, 0) / count;
    } else {
      clusters.push({
        x: robot.x,
        y: robot.y,
        robots: [robot],
      });
    }
  }

  return clusters;
}
