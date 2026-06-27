/**
 * @file scan-merge.ts
 * @description Pure geometry helpers for scan-session point clouds: lift points
 *   between the robot `base_link` frame and the shared world frame, and voxel-
 *   downsample a cloud to a uniform density.
 *
 * These are deliberately side-effect-free and unit-tested so the single
 * world↔base transform lives in one place (a frame mix-up is the classic bug in
 * a layered digital twin). `yaw` is always in **radians** here — the caller is
 * responsible for converting the simulator's degree heading before calling in.
 *
 * @status live
 */

/** A planar pose in the world frame. `yaw` is radians, about +z. */
export interface ScanPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/**
 * Lift a point from the robot base frame into the world frame.
 *
 * Rotates by `+yaw` about z, then translates by `(pose.x, pose.y, pose.z)`.
 * x-forward / y-left / z-up throughout.
 */
export function baseToWorld(
  px: number,
  py: number,
  pz: number,
  pose: ScanPose,
): [number, number, number] {
  const c = Math.cos(pose.yaw);
  const s = Math.sin(pose.yaw);
  return [pose.x + px * c - py * s, pose.y + px * s + py * c, pose.z + pz];
}

/**
 * Project a world point back into the robot base frame — the inverse of
 * {@link baseToWorld}. Translates by `-(pose.x, pose.y, pose.z)` then rotates by
 * `-yaw` about z.
 */
export function worldToBase(
  wx: number,
  wy: number,
  wz: number,
  pose: ScanPose,
): [number, number, number] {
  const c = Math.cos(pose.yaw);
  const s = Math.sin(pose.yaw);
  const dx = wx - pose.x;
  const dy = wy - pose.y;
  // Rotate by -yaw: [ c  s; -s  c ]
  return [dx * c + dy * s, -dx * s + dy * c, wz - pose.z];
}

/** Integer voxel key for a point, used for dedup/downsampling. */
export function voxelKey(x: number, y: number, z: number, voxel: number): string {
  const ix = Math.floor(x / voxel);
  const iy = Math.floor(y / voxel);
  const iz = Math.floor(z / voxel);
  return `${ix},${iy},${iz}`;
}

/** A flat point cloud: interleaved `positions` `[x,y,z,...]` + `intensities`. */
export interface FlatCloud {
  positions: number[];
  intensities: number[];
}

/**
 * Voxel-downsample a flat cloud: keep the first point seen in each voxel cell.
 * Deterministic (input order preserved) and O(n). Returns a new cloud; the
 * input is untouched.
 */
export function voxelDownsample(cloud: FlatCloud, voxel: number): FlatCloud {
  if (voxel <= 0) return { positions: [...cloud.positions], intensities: [...cloud.intensities] };
  const seen = new Set<string>();
  const positions: number[] = [];
  const intensities: number[] = [];
  const n = Math.floor(cloud.positions.length / 3);
  for (let i = 0; i < n; i++) {
    const x = cloud.positions[i * 3];
    const y = cloud.positions[i * 3 + 1];
    const z = cloud.positions[i * 3 + 2];
    const key = voxelKey(x, y, z, voxel);
    if (seen.has(key)) continue;
    seen.add(key);
    positions.push(x, y, z);
    intensities.push(cloud.intensities[i] ?? 0);
  }
  return { positions, intensities };
}
