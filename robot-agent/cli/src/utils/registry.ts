/**
 * @file registry.ts
 * @description Persistent robot profile registry for lerobot wrapper commands
 */

import Conf from 'conf';

// ============================================================================
// TYPES
// ============================================================================

export interface CameraConfig {
  name: string;
  type: string;
  index: number;
  width?: number;
  height?: number;
  fps?: number;
}

export interface RobotProfile {
  name: string;
  type: string;
  port: string;
  id: string;
  calibrationDir?: string;
  cameras?: CameraConfig[];
  teleop?: {
    type: string;
    port: string;
    id?: string;
  };
}

interface RobotRegistry {
  robots: Record<string, RobotProfile>;
}

// ============================================================================
// STORE
// ============================================================================

const registry = new Conf<RobotRegistry>({
  projectName: 'roboctl',
  configName: 'robots',
  defaults: { robots: {} },
});

// ============================================================================
// CRUD
// ============================================================================

export function getRobot(name: string): RobotProfile | undefined {
  const robots = registry.get('robots');
  return robots[name];
}

export function setRobot(name: string, profile: RobotProfile): void {
  const robots = registry.get('robots');
  robots[name] = profile;
  registry.set('robots', robots);
}

export function listRobots(): Record<string, RobotProfile> {
  return registry.get('robots');
}

export function removeRobot(name: string): boolean {
  const robots = registry.get('robots');
  if (!(name in robots)) return false;
  delete robots[name];
  registry.set('robots', robots);
  return true;
}

// ============================================================================
// ARG BUILDERS
// ============================================================================

export function robotArgs(profile: RobotProfile): string[] {
  const args = [
    `--robot.type=${profile.type}`,
    `--robot.port=${profile.port}`,
    `--robot.id=${profile.id}`,
  ];
  if (profile.calibrationDir) {
    args.push(`--robot.calibration_dir=${profile.calibrationDir}`);
  }
  if (profile.cameras && profile.cameras.length > 0) {
    const camObj: Record<string, object> = {};
    for (const cam of profile.cameras) {
      camObj[cam.name] = {
        type: cam.type,
        index_or_path: cam.index,
        ...(cam.width && { width: cam.width }),
        ...(cam.height && { height: cam.height }),
        ...(cam.fps && { fps: cam.fps }),
      };
    }
    args.push(`--robot.cameras=${JSON.stringify(camObj)}`);
  }
  return args;
}

export function teleopArgs(profile: RobotProfile): string[] {
  if (!profile.teleop) return [];
  const args = [
    `--teleop.type=${profile.teleop.type}`,
    `--teleop.port=${profile.teleop.port}`,
  ];
  if (profile.teleop.id) {
    args.push(`--teleop.id=${profile.teleop.id}`);
  }
  return args;
}
