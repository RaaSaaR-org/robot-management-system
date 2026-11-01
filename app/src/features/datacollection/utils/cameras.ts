/**
 * @file cameras.ts
 * @description Which wrist cameras a robot has and a session records, and the
 *              short label for a session's camera set (TASK-441). TASK-442:
 *              the cameras a session page shows (no wrist it does not
 *              record), and the camera count for the systems strip's cell.
 * @feature datacollection
 */

import type { RobotCameraList } from '@/features/robots/api/cameraApi';
import type { TeleoperationSession } from '../types/datacollection.types';

/** The wrist camera names, the same on the wire, the sidecar, the sim and the agent. */
export const WRIST_CAMERAS = {
  left: 'left_wrist_camera',
  right: 'right_wrist_camera',
} as const;

const WRIST_ORDER: readonly string[] = [WRIST_CAMERAS.left, WRIST_CAMERAS.right];

/** "Left wrist" / "Right wrist" for a wrist camera; null for any other camera (TASK-442). */
export function wristCameraLabel(name: string): string | null {
  if (name === WRIST_CAMERAS.left) return 'Left wrist';
  if (name === WRIST_CAMERAS.right) return 'Right wrist';
  return null;
}

/** The wrist names in `names`, left first, each once. */
function wristsIn(names: readonly string[] | null | undefined): string[] {
  return WRIST_ORDER.filter((wrist) => names?.includes(wrist));
}

/**
 * The wrist cameras a robot is set up with, left first — up or not. Reads
 * `configured` when the sidecar sends it, else the served list.
 */
export function robotWristCameras(list?: RobotCameraList | null): string[] {
  return wristsIn(list?.configured ?? list?.cameras);
}

/** The wrist cameras a session records, left first. None for a head-only session. */
export function sessionWristCameras(session: Pick<TeleoperationSession, 'cameras'> | null | undefined): string[] {
  return wristsIn(session?.cameras);
}

/**
 * The cameras the session page shows: every camera the robot serves, less the
 * wrist cameras the session does not record. A head-only session on a wrist
 * robot looks like a robot without wrist cameras (D2); any other camera stays.
 */
export function sessionViewCameras(served: readonly string[], sessionWrists: readonly string[]): string[] {
  const dropped = WRIST_ORDER.filter((wrist) => !sessionWrists.includes(wrist));
  return dropped.some((wrist) => served.includes(wrist)) ? served.filter((name) => !dropped.includes(name)) : [...served];
}

/**
 * "Head only", "Head + 2 wrists", "Head + left wrist", … — the camera set a
 * session records, in a few words. No list is the head camera only.
 */
export function cameraSetLabel(cameras?: readonly string[] | null): string {
  if (!cameras || cameras.length === 0) return 'Head only';
  const wrists = wristsIn(cameras);
  const hasHead = cameras.includes('head_camera');
  const others = cameras.filter((c) => c !== 'head_camera' && !WRIST_ORDER.includes(c)).length;
  const parts: string[] = [];
  if (hasHead) parts.push('Head');
  if (wrists.length === 2) parts.push('2 wrists');
  else if (wrists.length === 1) parts.push(wrists[0] === WRIST_CAMERAS.left ? 'left wrist' : 'right wrist');
  if (others > 0) parts.push(others === 1 ? '1 other camera' : `${others} other cameras`);
  if (hasHead && parts.length === 1) return 'Head only';
  const label = parts.join(' + ');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * "Head only", "3 cameras" — the camera set in a word or two, for the systems
 * strip's Cameras cell, which is ~70 px of text wide when all eight cells share
 * one row. The cell's title and the popover carry `cameraSetLabel`.
 */
export function cameraCountLabel(cameras?: readonly string[] | null): string {
  const label = cameraSetLabel(cameras);
  if (label === 'Head only') return label;
  const count = new Set(cameras).size;
  return count === 1 ? '1 camera' : `${count} cameras`;
}
