/**
 * @file pointcloud.ts
 * @description Point-cloud helpers: binary frame decoder (matches the agent's
 *              pointcloud-binary wire format) and a client-side binary PCD
 *              exporter for the "Download" action.
 * @feature robots
 */

import type { PointCloudFrame } from '../types/robots.types';

const POINTCLOUD_MAGIC = 0x504e4431; // "PND1"
const POINTCLOUD_HEADER_BYTES = 32;

export interface DecodedPointCloud {
  sequence: number;
  pointCount: number;
  hasIntensity: boolean;
  positions: Float32Array;
  intensities: Float32Array;
}

/**
 * Decode the compact binary wire format (quantized uint16 XYZ + uint8 intensity)
 * produced by the robot agent's point-cloud WebSocket.
 */
export function decodePointCloudFrame(buffer: ArrayBuffer): DecodedPointCloud {
  const view = new DataView(buffer);
  const magic = view.getUint32(0, true);
  if (magic !== POINTCLOUD_MAGIC) {
    throw new Error(`Invalid point-cloud frame magic: 0x${magic.toString(16)}`);
  }
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

  return { sequence, pointCount: n, hasIntensity, positions, intensities };
}

/**
 * Encode a point-cloud frame as a binary PCD blob (float32 x,y,z,intensity) for
 * download. Compatible with CloudCompare, Foxglove, three.js PCDLoader, etc.
 */
export function frameToPcdBlob(frame: PointCloudFrame): Blob {
  const n = frame.pointCount;
  const positions = frame.positions;
  const intensities = frame.intensities;
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

  const headerBytes = new TextEncoder().encode(header);
  const body = new ArrayBuffer(n * 16);
  const bodyView = new DataView(body);
  for (let i = 0; i < n; i++) {
    const off = i * 16;
    bodyView.setFloat32(off, positions[i * 3] ?? 0, true);
    bodyView.setFloat32(off + 4, positions[i * 3 + 1] ?? 0, true);
    bodyView.setFloat32(off + 8, positions[i * 3 + 2] ?? 0, true);
    bodyView.setFloat32(off + 12, frame.hasIntensity ? (intensities[i] ?? 0) : 0, true);
  }

  return new Blob([headerBytes, body], { type: 'application/octet-stream' });
}

/**
 * Parse a binary PCD into flat arrays. Reads the FIELDS/SIZE/COUNT header to
 * compute the per-point stride and field offsets, so it handles both the app's
 * `x y z intensity` clouds AND the twin-builder sidecar's `x y z` clouds (and
 * any field order). Intensity defaults to 0 when the cloud has no such field.
 */
export function parsePcdBinary(buffer: ArrayBuffer): {
  positions: Float32Array;
  intensities: Float32Array;
  pointCount: number;
} {
  const bytes = new Uint8Array(buffer);
  const marker = 'DATA binary\n';
  // The header is ASCII; scan a generous window for the data marker.
  const headerText = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 2048)));
  const markerIdx = headerText.indexOf(marker);
  if (markerIdx === -1) {
    throw new Error('Unsupported PCD: expected "DATA binary"');
  }
  const dataOffset = markerIdx + marker.length;

  const fields = (headerText.match(/FIELDS\s+(.+)/)?.[1] ?? 'x y z').trim().split(/\s+/);
  const sizes = (headerText.match(/SIZE\s+(.+)/)?.[1] ?? '4 4 4').trim().split(/\s+/).map(Number);
  const counts = (headerText.match(/COUNT\s+(.+)/)?.[1] ?? fields.map(() => '1').join(' '))
    .trim().split(/\s+/).map(Number);
  const pointsMatch = headerText.match(/POINTS\s+(\d+)/) ?? headerText.match(/WIDTH\s+(\d+)/);
  const n = pointsMatch ? parseInt(pointsMatch[1], 10) : 0;

  // Byte offset of each field within a point record, and the total stride.
  const offsets: Record<string, number> = {};
  let stride = 0;
  for (let f = 0; f < fields.length; f++) {
    offsets[fields[f]] = stride;
    stride += (sizes[f] ?? 4) * (counts[f] ?? 1);
  }
  const ox = offsets.x ?? 0;
  const oy = offsets.y ?? 4;
  const oz = offsets.z ?? 8;
  const oi = offsets.intensity; // undefined when absent

  const positions = new Float32Array(n * 3);
  const intensities = new Float32Array(n);
  const view = new DataView(buffer, dataOffset);
  for (let i = 0; i < n; i++) {
    const base = i * stride;
    positions[i * 3] = view.getFloat32(base + ox, true);
    positions[i * 3 + 1] = view.getFloat32(base + oy, true);
    positions[i * 3 + 2] = view.getFloat32(base + oz, true);
    intensities[i] = oi === undefined ? 0 : view.getFloat32(base + oi, true);
  }
  return { positions, intensities, pointCount: n };
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
