/**
 * @file mapExport.ts
 * @description Export the robot's occupancy grid (TASK-206 payload) as files
 *              other tools read: a ROS `map_server` pair (binary PGM + YAML,
 *              loadable in RViz / Nav2 / Foxglove), a PNG, and the raw JSON.
 *              Everything is computed from the payload already in the store —
 *              no round trip to the robot.
 * @feature agentmode
 */

import type { RobotCloudPayload, RobotMapGrid } from '../types/agentmode.types';

/** Wire scale: cells are Int8 log-odds × 25 (matches the agent's LOGODDS_SCALE). */
const LOGODDS_SCALE = 25;

/** ROS map_server conventions: 0 = occupied, 254 = free, 205 = unknown. */
export const PGM_OCCUPIED = 0;
export const PGM_FREE = 254;
export const PGM_UNKNOWN = 205;

/** Decode the base64 Int8 cells; null when the payload is not what it says it is. */
export function decodeCells(grid: RobotMapGrid): Int8Array | null {
  let bytes: Uint8Array;
  try {
    const bin = atob(grid.cells);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch {
    return null;
  }
  if (bytes.length !== grid.width * grid.height) return null;
  return new Int8Array(bytes.buffer, bytes.byteOffset, bytes.length);
}

/**
 * Classify every cell as PGM grey. Row 0 of the result is the TOP of the image
 * (largest y) — the map convention, so north is up and the origin in the YAML
 * refers to the bottom-left pixel exactly as map_server expects.
 */
export function gridToPgmBody(grid: RobotMapGrid): Uint8Array | null {
  const cells = decodeCells(grid);
  if (!cells) return null;
  const { width, height } = grid;
  const occ = Math.round(grid.occupiedAbove * LOGODDS_SCALE);
  const free = Math.round(grid.freeBelow * LOGODDS_SCALE);
  const out = new Uint8Array(width * height);
  for (let row = 0; row < height; row++) {
    const srcRow = height - 1 - row;
    for (let col = 0; col < width; col++) {
      const v = cells[srcRow * width + col];
      out[row * width + col] = v >= occ ? PGM_OCCUPIED : v <= free ? PGM_FREE : PGM_UNKNOWN;
    }
  }
  return out;
}

/** Binary PGM (P5). */
export function gridToPgm(grid: RobotMapGrid): Blob | null {
  const body = gridToPgmBody(grid);
  if (!body) return null;
  const header = new TextEncoder().encode(
    `P5\n# odom-frame occupancy grid, ${grid.resolution} m/cell, origin (${grid.originX}, ${grid.originY}), ` +
      `frame ${grid.frameId ?? 'unknown'}, ${grid.poseCount} poses\n${grid.width} ${grid.height}\n255\n`,
  );
  return new Blob([header, body], { type: 'image/x-portable-graymap' });
}

/**
 * The map_server YAML that goes with the PGM. `origin` is the world pose of the
 * bottom-left pixel; the thresholds are the ROS defaults, chosen so that the
 * three greys above land in the three classes.
 */
export function gridToMapServerYaml(grid: RobotMapGrid, imageFile: string): string {
  return [
    `image: ${imageFile}`,
    `resolution: ${grid.resolution}`,
    `origin: [${grid.originX}, ${grid.originY}, 0.0]`,
    'negate: 0',
    'occupied_thresh: 0.65',
    'free_thresh: 0.196',
    `# frame: ${grid.frame} (${grid.frameId ?? 'unknown'}), ${grid.poseCount} poses, ` +
      `${grid.knownCells} known / ${grid.occupiedCells} occupied cells, ${grid.lastIntegratedAt ?? 'never'}`,
    '',
  ].join('\n');
}

/**
 * PNG via an offscreen canvas: occupied dark, free light, unknown mid grey,
 * north up, `scale` px per cell so a 0.1 m grid is legible.
 */
export function gridToPng(grid: RobotMapGrid, scale = 4): Promise<Blob | null> {
  const body = gridToPgmBody(grid);
  if (!body || typeof document === 'undefined') return Promise.resolve(null);
  const canvas = document.createElement('canvas');
  canvas.width = grid.width * scale;
  canvas.height = grid.height * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve(null);
  const img = ctx.createImageData(grid.width, grid.height);
  for (let i = 0; i < body.length; i++) {
    const g = body[i] === PGM_OCCUPIED ? 30 : body[i] === PGM_FREE ? 235 : 128;
    img.data[i * 4] = g;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = g;
    img.data[i * 4 + 3] = 255;
  }
  const small = document.createElement('canvas');
  small.width = grid.width;
  small.height = grid.height;
  small.getContext('2d')?.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
}

/** File stem shared by every format, so a PGM and its YAML sit together. */
export function mapExportStem(robotId: string, grid: RobotMapGrid): string {
  const stamp = (grid.lastIntegratedAt ?? new Date().toISOString()).replace(/[:.]/g, '-').slice(0, 19);
  return `map-${robotId}-${stamp}`;
}

/** Trigger a browser download of a Blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export type MapExportFormat = 'pgm' | 'png' | 'json';

/**
 * Save the grid in one format. `pgm` downloads TWO files — the image and its
 * YAML — because one without the other is not a map to map_server.
 * Returns false when the grid could not be decoded.
 */
export async function exportMap(robotId: string, grid: RobotMapGrid, format: MapExportFormat): Promise<boolean> {
  const stem = mapExportStem(robotId, grid);
  if (format === 'json') {
    downloadBlob(new Blob([JSON.stringify(grid, null, 2)], { type: 'application/json' }), `${stem}.json`);
    return true;
  }
  if (format === 'png') {
    const png = await gridToPng(grid);
    if (!png) return false;
    downloadBlob(png, `${stem}.png`);
    return true;
  }
  const pgm = gridToPgm(grid);
  if (!pgm) return false;
  downloadBlob(pgm, `${stem}.pgm`);
  downloadBlob(new Blob([gridToMapServerYaml(grid, `${stem}.pgm`)], { type: 'text/yaml' }), `${stem}.yaml`);
  return true;
}

// ============================================================================
// World cloud (TASK-211)
// ============================================================================


/** Decode the cloud's base64 Float32 xyz triplets; null when malformed. */
export function decodeCloudPositions(cloud: RobotCloudPayload): Float32Array | null {
  let bytes: Uint8Array;
  try {
    const bin = atob(cloud.positions);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch {
    return null;
  }
  if (bytes.length % 12 !== 0) return null;
  // Copy so the view is aligned regardless of the source buffer's offset.
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

/** Binary little-endian PCD (x y z) — CloudCompare, Open3D, PCL, Foxglove. */
export function cloudToPcd(positions: Float32Array, comment: string): Blob {
  const n = positions.length / 3;
  const header = new TextEncoder().encode(
    [
      '# .PCD v0.7 - Point Cloud Data file format',
      `# ${comment}`,
      'VERSION 0.7',
      'FIELDS x y z',
      'SIZE 4 4 4',
      'TYPE F F F',
      'COUNT 1 1 1',
      `WIDTH ${n}`,
      'HEIGHT 1',
      'VIEWPOINT 0 0 0 1 0 0 0',
      `POINTS ${n}`,
      'DATA binary',
      '',
    ].join('\n'),
  );
  return new Blob([header, littleEndian(positions)], { type: 'application/octet-stream' });
}

/** Binary little-endian PLY (vertex x y z) — MeshLab, Blender, three.js PLYLoader. */
export function cloudToPly(positions: Float32Array, comment: string): Blob {
  const n = positions.length / 3;
  const header = new TextEncoder().encode(
    ['ply', 'format binary_little_endian 1.0', `comment ${comment}`, `element vertex ${n}`, 'property float x', 'property float y', 'property float z', 'end_header', ''].join('\n'),
  );
  return new Blob([header, littleEndian(positions)], { type: 'application/octet-stream' });
}

/** Float32 bytes in little-endian order whatever the host is. */
function littleEndian(f: Float32Array): Uint8Array {
  const out = new Uint8Array(f.length * 4);
  const view = new DataView(out.buffer);
  for (let i = 0; i < f.length; i++) view.setFloat32(i * 4, f[i], true);
  return out;
}

export type CloudExportFormat = 'pcd' | 'ply';

/** Save the world cloud as PCD or PLY. Returns false when the payload could not be decoded. */
export function exportCloud(robotId: string, cloud: RobotCloudPayload, format: CloudExportFormat): boolean {
  const positions = decodeCloudPositions(cloud);
  if (!positions) return false;
  const stamp = (cloud.lastIntegratedAt ?? new Date().toISOString()).replace(/[:.]/g, '-').slice(0, 19);
  const stem = `cloud-${robotId}-${stamp}`;
  const comment = `odom-frame world cloud of ${robotId}, frame ${cloud.frameId ?? 'unknown'}, ${cloud.voxelM} m voxels, ${cloud.frames} frames`;
  downloadBlob(format === 'pcd' ? cloudToPcd(positions, comment) : cloudToPly(positions, comment), `${stem}.${format}`);
  return true;
}
