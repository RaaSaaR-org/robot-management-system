/**
 * @file pcd.ts
 * @description Binary PCD (Point Cloud Data) encoder for recorded scans.
 *
 * Writes the PCL-native binary PCD format (float32 x,y,z,intensity) so scans are
 * interoperable with three.js PCDLoader, Foxglove, CloudCompare, Open3D, etc.
 * @feature storage
 */

export interface PointCloudLike {
  pointCount: number;
  positions: number[];
  intensities: number[];
  hasIntensity: boolean;
}

/**
 * Compute the axis-aligned bounding box of a flat positions array.
 * @returns [minX, minY, minZ, maxX, maxY, maxZ]
 */
export function computeBounds(positions: number[]): [number, number, number, number, number, number] {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  const n = Math.floor(positions.length / 3);
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  if (n === 0) return [0, 0, 0, 0, 0, 0];
  return [minX, minY, minZ, maxX, maxY, maxZ];
}

/**
 * Encode a point cloud as binary PCD (v0.7), fields x,y,z,intensity (float32).
 */
export function encodePcdBinary(cloud: PointCloudLike): Buffer {
  const n = cloud.pointCount;
  const header =
    `# .PCD v0.7 - Point Cloud Data file format\n` +
    `VERSION 0.7\n` +
    `FIELDS x y z intensity\n` +
    `SIZE 4 4 4 4\n` +
    `TYPE F F F F\n` +
    `COUNT 1 1 1 1\n` +
    `WIDTH ${n}\n` +
    `HEIGHT 1\n` +
    `VIEWPOINT 0 0 0 1 0 0 0\n` +
    `POINTS ${n}\n` +
    `DATA binary\n`;
  const headerBuf = Buffer.from(header, 'ascii');

  const body = Buffer.alloc(n * 16);
  for (let i = 0; i < n; i++) {
    const off = i * 16;
    body.writeFloatLE(cloud.positions[i * 3] ?? 0, off);
    body.writeFloatLE(cloud.positions[i * 3 + 1] ?? 0, off + 4);
    body.writeFloatLE(cloud.positions[i * 3 + 2] ?? 0, off + 8);
    body.writeFloatLE(cloud.hasIntensity ? (cloud.intensities[i] ?? 0) : 0, off + 12);
  }

  return Buffer.concat([headerBuf, body]);
}
