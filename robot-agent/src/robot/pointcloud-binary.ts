/**
 * @file pointcloud-binary.ts
 * @description Compact binary wire format for streaming point-cloud frames.
 *
 * A point cloud as JSON (~45 B/point) is ~3x larger than raw float32 and forces
 * a heavy per-frame parse on the browser main thread. For the live WebSocket
 * stream we instead quantize XYZ to uint16 over the frame's bounding box and
 * intensity to uint8, behind a 32-byte little-endian header. At ~7 B/point this
 * is ~2.3x smaller than raw float32 XYZI and halves GPU upload bandwidth.
 *
 * Layout (little-endian), structure-of-arrays so views map without copies:
 *   off  size  type      field
 *   0    4     uint32    magic = 0x504E4431 ("PND1")
 *   4    2     uint16    version = 1
 *   6    2     uint16    flags (bit0: hasIntensity)
 *   8    4     uint32    pointCount (N)
 *   12   4     float32   originX  (bbox min, meters)
 *   16   4     float32   originY
 *   20   4     float32   originZ
 *   24   4     float32   scale    (meters per quantization unit)
 *   28   4     uint32    sequence
 *   32   2N    uint16[]  X quantized
 *   ..   2N    uint16[]  Y quantized
 *   ..   2N    uint16[]  Z quantized
 *   ..   1N    uint8[]   intensity (0..255), present only if hasIntensity
 *
 * @status live
 */

import type { PointCloudFrame, PointCloudSensorType } from './types.js';

export const POINTCLOUD_MAGIC = 0x504e4431; // "PND1"
export const POINTCLOUD_VERSION = 1;
export const POINTCLOUD_HEADER_BYTES = 32;

/** Decoded header + dequantized points (used by tests; the app has its own decoder). */
export interface DecodedPointCloud {
  version: number;
  sequence: number;
  pointCount: number;
  hasIntensity: boolean;
  positions: Float32Array;
  intensities: Float32Array;
}

const U16_MAX = 65535;

/**
 * Encode a point-cloud frame to the compact binary wire format.
 */
export function encodePointCloudFrame(frame: PointCloudFrame): Buffer {
  const n = frame.pointCount;
  const pos = frame.positions;

  // Bounding box for quantization.
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  if (n === 0) { minX = minY = minZ = 0; maxX = maxY = maxZ = 0; }

  const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1e-3);
  const scale = span / U16_MAX;

  const hasIntensity = frame.hasIntensity && frame.intensities.length >= n;
  const bytesPerPoint = 6 + (hasIntensity ? 1 : 0);
  const buf = Buffer.alloc(POINTCLOUD_HEADER_BYTES + n * bytesPerPoint);

  buf.writeUInt32LE(POINTCLOUD_MAGIC, 0);
  buf.writeUInt16LE(POINTCLOUD_VERSION, 4);
  buf.writeUInt16LE(hasIntensity ? 1 : 0, 6);
  buf.writeUInt32LE(n, 8);
  buf.writeFloatLE(minX, 12);
  buf.writeFloatLE(minY, 16);
  buf.writeFloatLE(minZ, 20);
  buf.writeFloatLE(scale, 24);
  buf.writeUInt32LE(frame.sequence >>> 0, 28);

  const q = (v: number, origin: number) =>
    Math.max(0, Math.min(U16_MAX, Math.round((v - origin) / scale)));

  let off = POINTCLOUD_HEADER_BYTES;
  for (let i = 0; i < n; i++) { buf.writeUInt16LE(q(pos[i * 3], minX), off); off += 2; }
  for (let i = 0; i < n; i++) { buf.writeUInt16LE(q(pos[i * 3 + 1], minY), off); off += 2; }
  for (let i = 0; i < n; i++) { buf.writeUInt16LE(q(pos[i * 3 + 2], minZ), off); off += 2; }
  if (hasIntensity) {
    for (let i = 0; i < n; i++) {
      buf.writeUInt8(Math.max(0, Math.min(255, Math.round(frame.intensities[i] * 255))), off);
      off += 1;
    }
  }

  return buf;
}

/**
 * Decode the compact binary wire format back to float positions / intensities.
 * Mirrors the app-side decoder; primarily used for round-trip tests.
 */
export function decodePointCloudFrame(buffer: ArrayBuffer | Uint8Array): DecodedPointCloud {
  const view = ArrayBuffer.isView(buffer)
    ? new DataView(buffer.buffer as ArrayBuffer, buffer.byteOffset, buffer.byteLength)
    : new DataView(buffer as ArrayBuffer);

  const magic = view.getUint32(0, true);
  if (magic !== POINTCLOUD_MAGIC) {
    throw new Error(`Invalid point-cloud frame magic: 0x${magic.toString(16)}`);
  }
  const version = view.getUint16(4, true);
  const flags = view.getUint16(6, true);
  const hasIntensity = (flags & 1) === 1;
  const n = view.getUint32(8, true);
  const originX = view.getFloat32(12, true);
  const originY = view.getFloat32(16, true);
  const originZ = view.getFloat32(20, true);
  const scale = view.getFloat32(24, true);
  const sequence = view.getUint32(28, true);

  const positions = new Float32Array(n * 3);
  const intensities = new Float32Array(n);

  let off = POINTCLOUD_HEADER_BYTES;
  for (let i = 0; i < n; i++) { positions[i * 3] = originX + view.getUint16(off, true) * scale; off += 2; }
  for (let i = 0; i < n; i++) { positions[i * 3 + 1] = originY + view.getUint16(off, true) * scale; off += 2; }
  for (let i = 0; i < n; i++) { positions[i * 3 + 2] = originZ + view.getUint16(off, true) * scale; off += 2; }
  if (hasIntensity) {
    for (let i = 0; i < n; i++) { intensities[i] = view.getUint8(off) / 255; off += 1; }
  }

  return { version, sequence, pointCount: n, hasIntensity, positions, intensities };
}

/** Re-export for symmetry with consumers that need the sensor type union. */
export type { PointCloudSensorType };
