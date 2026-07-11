/**
 * @file pointcloud-parse.ts
 * @description Parsers for user-supplied point-cloud files (twin scan import).
 *              Supports PLY (ascii + binary_little_endian) and PCD (ascii +
 *              binary), extracting x/y/z (+ optional intensity) into the same
 *              PointCloudLike shape the PCD encoder consumes. Pure functions —
 *              no I/O — so the format edge cases are unit-testable.
 * @feature digitaltwin
 */

import type { PointCloudLike } from './pcd.js';

/** Hard cap on parsed points — a room-scale scan, not a full mapping run. */
export const MAX_IMPORT_POINTS = 5_000_000;

/** Thrown for malformed / unsupported files; routes map it to HTTP 400. */
export class PointCloudParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PointCloudParseError';
  }
}

/** A parsed cloud plus how it was read (for logging / provenance). */
export interface ParsedPointCloud extends PointCloudLike {
  format: 'ply' | 'pcd';
}

/**
 * Parse a point-cloud file by extension (falls back to content sniffing).
 * Accepts `.ply` and `.pcd`; throws PointCloudParseError otherwise.
 */
export function parsePointCloudFile(buffer: Buffer, filename: string): ParsedPointCloud {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.ply')) return { ...parsePly(buffer), format: 'ply' };
  if (lower.endsWith('.pcd')) return { ...parsePcd(buffer), format: 'pcd' };
  // No trusted extension — sniff the magic.
  const head = buffer.subarray(0, 64).toString('ascii');
  if (head.startsWith('ply')) return { ...parsePly(buffer), format: 'ply' };
  if (head.includes('VERSION') && head.startsWith('#')) return { ...parsePcd(buffer), format: 'pcd' };
  throw new PointCloudParseError(
    `Unsupported point-cloud format for "${filename}" — expected .ply or .pcd`,
  );
}

// ============================================================================
// PLY
// ============================================================================

const PLY_TYPE_SIZE: Record<string, number> = {
  char: 1, int8: 1, uchar: 1, uint8: 1,
  short: 2, int16: 2, ushort: 2, uint16: 2,
  int: 4, int32: 4, uint: 4, uint32: 4,
  float: 4, float32: 4,
  double: 8, float64: 8,
};

interface PlyProperty {
  type: string;
  name: string;
}

function parsePly(buffer: Buffer): PointCloudLike {
  // Header is ASCII up to "end_header\n" regardless of body format.
  const headerEndToken = 'end_header';
  const headText = buffer.subarray(0, Math.min(buffer.length, 64 * 1024)).toString('latin1');
  const endIdx = headText.indexOf(headerEndToken);
  if (!headText.startsWith('ply') || endIdx === -1) {
    throw new PointCloudParseError('Not a PLY file (missing ply magic / end_header)');
  }
  const headerText = headText.slice(0, endIdx);
  // Body starts after the end_header line's newline.
  const bodyStart = headText.indexOf('\n', endIdx) + 1;

  let format: 'ascii' | 'binary_little_endian' | null = null;
  let vertexCount = 0;
  const vertexProps: PlyProperty[] = [];
  let inVertexElement = false;
  let sawElementAfterVertex = false;

  for (const rawLine of headerText.split('\n')) {
    const line = rawLine.trim();
    if (!line || line === 'ply' || line.startsWith('comment') || line.startsWith('obj_info')) continue;
    const parts = line.split(/\s+/);
    if (parts[0] === 'format') {
      if (parts[1] === 'ascii') format = 'ascii';
      else if (parts[1] === 'binary_little_endian') format = 'binary_little_endian';
      else throw new PointCloudParseError(`Unsupported PLY format: ${parts[1]}`);
    } else if (parts[0] === 'element') {
      if (parts[1] === 'vertex') {
        inVertexElement = true;
        vertexCount = parseInt(parts[2], 10);
      } else {
        if (inVertexElement) sawElementAfterVertex = true;
        inVertexElement = false;
        // Elements BEFORE vertex would shift the binary offset unpredictably.
        if (vertexCount === 0 && format === 'binary_little_endian') {
          throw new PointCloudParseError(
            `Binary PLY with element "${parts[1]}" before vertex is not supported`,
          );
        }
      }
    } else if (parts[0] === 'property' && inVertexElement) {
      if (parts[1] === 'list') {
        throw new PointCloudParseError('PLY list properties on vertex are not supported');
      }
      vertexProps.push({ type: parts[1], name: parts[2] });
    }
  }

  if (!format) throw new PointCloudParseError('PLY header has no format line');
  if (!Number.isFinite(vertexCount) || vertexCount <= 0) {
    throw new PointCloudParseError('PLY has no vertices');
  }
  if (vertexCount > MAX_IMPORT_POINTS) {
    throw new PointCloudParseError(
      `PLY has ${vertexCount} points — exceeds the import cap of ${MAX_IMPORT_POINTS}`,
    );
  }

  const ix = vertexProps.findIndex((p) => p.name === 'x');
  const iy = vertexProps.findIndex((p) => p.name === 'y');
  const iz = vertexProps.findIndex((p) => p.name === 'z');
  if (ix === -1 || iy === -1 || iz === -1) {
    throw new PointCloudParseError('PLY vertex element is missing x/y/z properties');
  }
  const ii = vertexProps.findIndex((p) => p.name === 'intensity' || p.name === 'scalar_intensity');
  const hasIntensity = ii !== -1;

  const positions: number[] = [];
  const intensities: number[] = [];

  if (format === 'ascii') {
    const body = buffer.subarray(bodyStart).toString('latin1');
    let read = 0;
    let lineStart = 0;
    while (read < vertexCount && lineStart < body.length) {
      let lineEnd = body.indexOf('\n', lineStart);
      if (lineEnd === -1) lineEnd = body.length;
      const line = body.slice(lineStart, lineEnd).trim();
      lineStart = lineEnd + 1;
      if (!line) continue;
      const cols = line.split(/\s+/);
      const x = Number(cols[ix]);
      const y = Number(cols[iy]);
      const z = Number(cols[iz]);
      read++;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      positions.push(x, y, z);
      intensities.push(hasIntensity ? Number(cols[ii]) || 0 : 0);
    }
    if (read < vertexCount) {
      throw new PointCloudParseError(
        `PLY body truncated: expected ${vertexCount} vertices, found ${read}`,
      );
    }
  } else {
    // binary_little_endian — fixed stride over the vertex properties.
    const offsets: number[] = [];
    let stride = 0;
    for (const p of vertexProps) {
      const size = PLY_TYPE_SIZE[p.type];
      if (!size) throw new PointCloudParseError(`Unknown PLY property type: ${p.type}`);
      offsets.push(stride);
      stride += size;
    }
    const need = bodyStart + vertexCount * stride;
    if (buffer.length < need) {
      throw new PointCloudParseError(
        `PLY body truncated: need ${need} bytes, have ${buffer.length}`,
      );
    }
    const readScalar = (type: string, off: number): number => {
      switch (type) {
        case 'float': case 'float32': return buffer.readFloatLE(off);
        case 'double': case 'float64': return buffer.readDoubleLE(off);
        case 'char': case 'int8': return buffer.readInt8(off);
        case 'uchar': case 'uint8': return buffer.readUInt8(off);
        case 'short': case 'int16': return buffer.readInt16LE(off);
        case 'ushort': case 'uint16': return buffer.readUInt16LE(off);
        case 'int': case 'int32': return buffer.readInt32LE(off);
        case 'uint': case 'uint32': return buffer.readUInt32LE(off);
        default: throw new PointCloudParseError(`Unknown PLY property type: ${type}`);
      }
    };
    for (let v = 0; v < vertexCount; v++) {
      const base = bodyStart + v * stride;
      const x = readScalar(vertexProps[ix].type, base + offsets[ix]);
      const y = readScalar(vertexProps[iy].type, base + offsets[iy]);
      const z = readScalar(vertexProps[iz].type, base + offsets[iz]);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      positions.push(x, y, z);
      intensities.push(hasIntensity ? readScalar(vertexProps[ii].type, base + offsets[ii]) : 0);
    }
  }
  // sawElementAfterVertex (e.g. faces) is fine — we only read the vertex block.
  void sawElementAfterVertex;

  const pointCount = positions.length / 3;
  if (pointCount === 0) throw new PointCloudParseError('PLY contains no finite points');
  return { pointCount, positions, intensities, hasIntensity };
}

// ============================================================================
// PCD
// ============================================================================

function parsePcd(buffer: Buffer): PointCloudLike {
  // Header is ASCII lines up to and including the DATA line.
  const headText = buffer.subarray(0, Math.min(buffer.length, 16 * 1024)).toString('latin1');
  const dataMatch = /^DATA\s+(\S+)\s*$/m.exec(headText);
  if (!dataMatch) throw new PointCloudParseError('Not a PCD file (missing DATA line)');
  const dataMode = dataMatch[1];
  const bodyStart = headText.indexOf('\n', dataMatch.index) + 1;

  const header: Record<string, string[]> = {};
  for (const rawLine of headText.slice(0, dataMatch.index).split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const [key, ...rest] = line.split(/\s+/);
    header[key.toUpperCase()] = rest;
  }

  const fields = header.FIELDS ?? [];
  const sizes = (header.SIZE ?? []).map(Number);
  const types = header.TYPE ?? [];
  const counts = (header.COUNT ?? fields.map(() => '1')).map(Number);
  const pointCount = Number(header.POINTS?.[0] ?? Number(header.WIDTH?.[0] ?? 0) * Number(header.HEIGHT?.[0] ?? 1));

  if (!fields.length) throw new PointCloudParseError('PCD header has no FIELDS');
  if (!Number.isFinite(pointCount) || pointCount <= 0) {
    throw new PointCloudParseError('PCD has no points');
  }
  if (pointCount > MAX_IMPORT_POINTS) {
    throw new PointCloudParseError(
      `PCD has ${pointCount} points — exceeds the import cap of ${MAX_IMPORT_POINTS}`,
    );
  }

  const ix = fields.indexOf('x');
  const iy = fields.indexOf('y');
  const iz = fields.indexOf('z');
  if (ix === -1 || iy === -1 || iz === -1) {
    throw new PointCloudParseError('PCD is missing x/y/z fields');
  }
  const ii = fields.indexOf('intensity');
  const hasIntensity = ii !== -1;

  const positions: number[] = [];
  const intensities: number[] = [];

  if (dataMode === 'ascii') {
    const body = buffer.subarray(bodyStart).toString('latin1');
    let read = 0;
    for (const rawLine of body.split('\n')) {
      if (read >= pointCount) break;
      const line = rawLine.trim();
      if (!line) continue;
      const cols = line.split(/\s+/);
      const x = Number(cols[ix]);
      const y = Number(cols[iy]);
      const z = Number(cols[iz]);
      read++;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      positions.push(x, y, z);
      intensities.push(hasIntensity ? Number(cols[ii]) || 0 : 0);
    }
    if (read < pointCount) {
      throw new PointCloudParseError(
        `PCD body truncated: expected ${pointCount} points, found ${read}`,
      );
    }
  } else if (dataMode === 'binary') {
    // Per-field byte offsets within one point record.
    const offsets: number[] = [];
    let stride = 0;
    for (let f = 0; f < fields.length; f++) {
      offsets.push(stride);
      stride += (sizes[f] ?? 4) * (counts[f] ?? 1);
    }
    const need = bodyStart + pointCount * stride;
    if (buffer.length < need) {
      throw new PointCloudParseError(
        `PCD body truncated: need ${need} bytes, have ${buffer.length}`,
      );
    }
    const readField = (f: number, base: number): number => {
      const off = base + offsets[f];
      const size = sizes[f] ?? 4;
      const type = types[f] ?? 'F';
      if (type === 'F') return size === 8 ? buffer.readDoubleLE(off) : buffer.readFloatLE(off);
      if (type === 'I') {
        if (size === 1) return buffer.readInt8(off);
        if (size === 2) return buffer.readInt16LE(off);
        return buffer.readInt32LE(off);
      }
      // 'U'
      if (size === 1) return buffer.readUInt8(off);
      if (size === 2) return buffer.readUInt16LE(off);
      return buffer.readUInt32LE(off);
    };
    for (let p = 0; p < pointCount; p++) {
      const base = bodyStart + p * stride;
      const x = readField(ix, base);
      const y = readField(iy, base);
      const z = readField(iz, base);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      positions.push(x, y, z);
      intensities.push(hasIntensity ? readField(ii, base) : 0);
    }
  } else {
    throw new PointCloudParseError(
      `Unsupported PCD DATA mode: ${dataMode} (ascii and binary are supported)`,
    );
  }

  const finalCount = positions.length / 3;
  if (finalCount === 0) throw new PointCloudParseError('PCD contains no finite points');
  return { pointCount: finalCount, positions, intensities, hasIntensity };
}

// ============================================================================
// FLOOR NORMALIZATION
// ============================================================================

/**
 * Shift a cloud vertically so its floor sits at z = 0 — imported single-frame
 * clouds arrive in an arbitrary sensor frame (e.g. a head-mounted LiDAR sees
 * the floor at z ≈ -1.2 m), while every other twin layer assumes the floor
 * near z = 0. Uses the 0.5th percentile of z (not the min) so a few stray
 * under-floor returns don't drag the whole room down. Mutates in place and
 * returns the applied offset (worldZ = importedZ - offset).
 */
export function normalizeFloorToZero(cloud: PointCloudLike): number {
  const n = cloud.pointCount;
  if (n === 0) return 0;
  const zs = new Float64Array(n);
  for (let i = 0; i < n; i++) zs[i] = cloud.positions[i * 3 + 2];
  zs.sort();
  const floorZ = zs[Math.min(n - 1, Math.floor(n * 0.005))];
  if (!Number.isFinite(floorZ) || Math.abs(floorZ) < 1e-6) return 0;
  for (let i = 0; i < n; i++) cloud.positions[i * 3 + 2] -= floorZ;
  return floorZ;
}
