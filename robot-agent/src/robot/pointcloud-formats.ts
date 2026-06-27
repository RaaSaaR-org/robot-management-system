/**
 * @file pointcloud-formats.ts
 * @description Parsers for real recorded point-cloud files.
 *
 * Turns real LiDAR / depth-sensor recordings into a flat {@link RawCloud} so they
 * can be replayed through the perception pipeline exactly like a live scan. This
 * is the "real data" half of the perception feature: where {@link generateSyntheticScan}
 * fabricates a believable cloud, these parsers ingest genuine sensor captures.
 *
 * Supported formats:
 *   • PCD (PointCloudLibrary) — `DATA ascii`, `DATA binary`, `DATA binary_compressed`
 *     (the last via a self-contained LZF decoder; no native deps).
 *   • KITTI Velodyne `.bin` — interleaved float32 `x y z intensity` (the canonical
 *     real-LiDAR dump; same x-forward / y-left / z-up frame the G1 base uses).
 *
 * Parsers return RAW values in the file's own frame/units. Reframing, recentering,
 * intensity normalization and downsampling are the replay layer's job
 * (see pointcloud-replay.ts).
 *
 * @status live
 */

// ============================================================================
// TYPES
// ============================================================================

/** A parsed cloud in flat, interleaved form. Coordinates and intensity are raw. */
export interface RawCloud {
  /** Number of points. */
  count: number;
  /** Interleaved XYZ, length `count * 3`. */
  positions: Float32Array;
  /** Per-point intensity, length `count`. Zero-filled when the source has none. */
  intensities: Float32Array;
  /** Whether the source actually carried an intensity field. */
  hasIntensity: boolean;
}

function toU8(buffer: ArrayBuffer | Uint8Array): Uint8Array {
  return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
}

// ============================================================================
// LZF DECOMPRESSION (liblzf) — for PCD `DATA binary_compressed`
// ============================================================================

/**
 * Decompress an LZF (liblzf) stream — the codec PCL uses for
 * `DATA binary_compressed`. Pure JS port of liblzf's `lzf_decompress`; no
 * native module required.
 *
 * @param input        Compressed bytes.
 * @param expectedLen  Uncompressed length (from the PCD's second uint32 header).
 */
export function lzfDecompress(input: Uint8Array, expectedLen: number): Uint8Array {
  const out = new Uint8Array(expectedLen);
  const n = input.length;
  let ip = 0;
  let op = 0;

  while (ip < n) {
    let ctrl = input[ip++];

    if (ctrl < 32) {
      // Literal run of `ctrl + 1` bytes.
      let len = ctrl + 1;
      if (op + len > expectedLen) len = expectedLen - op;
      while (len-- > 0) out[op++] = input[ip++];
    } else {
      // Back reference: length in the top 3 bits, distance in the rest.
      let len = ctrl >> 5;
      if (len === 7) len += input[ip++];
      let ref = op - ((ctrl & 0x1f) << 8) - 1 - input[ip++];
      if (ref < 0) break; // malformed — bail gracefully
      let count = len + 2; // liblzf min match
      while (count-- > 0 && op < expectedLen) out[op++] = out[ref++];
    }
  }
  return out;
}

// ============================================================================
// PCD
// ============================================================================

interface PcdField {
  name: string;
  size: number; // bytes
  type: string; // 'F' | 'U' | 'I'
  count: number;
  /** Byte offset of this field within a single interleaved point record. */
  offset: number;
}

interface PcdHeader {
  fields: PcdField[];
  points: number;
  data: 'ascii' | 'binary' | 'binary_compressed';
  /** Byte offset where the data section begins (binary formats). */
  dataStart: number;
  /** Total bytes per point record (interleaved). */
  pointStride: number;
}

const TEXT_DECODER = new TextDecoder('ascii');

function parsePcdHeader(u8: Uint8Array): PcdHeader {
  // The header is ascii; read line by line until the DATA line, tracking the byte offset.
  let offset = 0;
  const lines: string[] = [];
  let dataLine = '';
  while (offset < u8.length) {
    let eol = offset;
    while (eol < u8.length && u8[eol] !== 0x0a) eol++;
    const line = TEXT_DECODER.decode(u8.subarray(offset, eol)).replace(/\r$/, '');
    offset = eol + 1;
    if (line.startsWith('DATA')) {
      dataLine = line;
      break;
    }
    lines.push(line);
  }

  const kv = new Map<string, string[]>();
  for (const line of lines) {
    if (line.startsWith('#') || line.trim() === '') continue;
    const parts = line.trim().split(/\s+/);
    kv.set(parts[0].toUpperCase(), parts.slice(1));
  }

  const names = kv.get('FIELDS') ?? [];
  const sizes = (kv.get('SIZE') ?? []).map(Number);
  const types = kv.get('TYPE') ?? [];
  const counts = (kv.get('COUNT') ?? []).map(Number);

  const fields: PcdField[] = [];
  let stride = 0;
  for (let i = 0; i < names.length; i++) {
    const size = sizes[i] ?? 4;
    const count = Number.isFinite(counts[i]) ? counts[i] : 1;
    fields.push({ name: names[i].toLowerCase(), size, type: (types[i] ?? 'F').toUpperCase(), count, offset: stride });
    stride += size * count;
  }

  const dataKind = (dataLine.split(/\s+/)[1] ?? 'ascii').toLowerCase();
  const data: PcdHeader['data'] =
    dataKind === 'binary_compressed' ? 'binary_compressed' : dataKind === 'binary' ? 'binary' : 'ascii';

  const widthArr = kv.get('WIDTH') ?? ['0'];
  const heightArr = kv.get('HEIGHT') ?? ['1'];
  const pointsFromWH = (Number(widthArr[0]) || 0) * (Number(heightArr[0]) || 1);
  const points = Number((kv.get('POINTS') ?? [])[0]) || pointsFromWH;

  return { fields, points, data, dataStart: offset, pointStride: stride };
}

/** Read a numeric field value from a DataView at `byteOffset` given PCD type+size. */
function readNumeric(view: DataView, byteOffset: number, type: string, size: number): number {
  if (type === 'F') return size === 8 ? view.getFloat64(byteOffset, true) : view.getFloat32(byteOffset, true);
  if (type === 'U') {
    if (size === 1) return view.getUint8(byteOffset);
    if (size === 2) return view.getUint16(byteOffset, true);
    return view.getUint32(byteOffset, true);
  }
  // 'I'
  if (size === 1) return view.getInt8(byteOffset);
  if (size === 2) return view.getInt16(byteOffset, true);
  return view.getInt32(byteOffset, true);
}

/** Pick the field used as intensity: prefer `intensity`, else `i`, then derive from `rgb`. */
function findIntensityField(fields: PcdField[]): PcdField | undefined {
  return fields.find((f) => f.name === 'intensity') ?? fields.find((f) => f.name === 'i');
}

/**
 * Parse a PCD file (ascii / binary / binary_compressed) into a {@link RawCloud}.
 * Extracts x, y, z (required) and intensity (optional).
 */
export function parsePcd(buffer: ArrayBuffer | Uint8Array): RawCloud {
  const u8 = toU8(buffer);
  const header = parsePcdHeader(u8);
  const fx = header.fields.find((f) => f.name === 'x');
  const fy = header.fields.find((f) => f.name === 'y');
  const fz = header.fields.find((f) => f.name === 'z');
  if (!fx || !fy || !fz) {
    throw new Error(`PCD missing x/y/z fields (got: ${header.fields.map((f) => f.name).join(',')})`);
  }
  const fi = findIntensityField(header.fields);
  const count = header.points;
  const positions = new Float32Array(count * 3);
  const intensities = new Float32Array(count);

  if (header.data === 'ascii') {
    // Index of each field among whitespace-separated columns (accounting for COUNT).
    const colIndex = (target: PcdField): number => {
      let col = 0;
      for (const f of header.fields) {
        if (f === target) return col;
        col += f.count;
      }
      return col;
    };
    const xi = colIndex(fx);
    const yi = colIndex(fy);
    const zi = colIndex(fz);
    const ii = fi ? colIndex(fi) : -1;
    const text = TEXT_DECODER.decode(u8.subarray(header.dataStart));
    const rows = text.split('\n');
    let p = 0;
    for (const row of rows) {
      if (p >= count) break;
      const t = row.trim();
      if (t === '' || t.startsWith('#')) continue;
      const cols = t.split(/\s+/);
      positions[p * 3] = Number(cols[xi]);
      positions[p * 3 + 1] = Number(cols[yi]);
      positions[p * 3 + 2] = Number(cols[zi]);
      if (ii >= 0) intensities[p] = Number(cols[ii]);
      p++;
    }
    return { count: p, positions: positions.subarray(0, p * 3), intensities: intensities.subarray(0, p), hasIntensity: !!fi };
  }

  // Binary / binary_compressed both end up as a typed byte block we DataView into.
  let view: DataView;
  let recordStride: number;
  let xOff: number;
  let yOff: number;
  let zOff: number;
  let iOff: number;

  if (header.data === 'binary') {
    view = new DataView(u8.buffer, u8.byteOffset + header.dataStart, u8.byteLength - header.dataStart);
    recordStride = header.pointStride;
    xOff = fx.offset;
    yOff = fy.offset;
    zOff = fz.offset;
    iOff = fi ? fi.offset : -1;
    for (let p = 0; p < count; p++) {
      const base = p * recordStride;
      positions[p * 3] = readNumeric(view, base + xOff, fx.type, fx.size);
      positions[p * 3 + 1] = readNumeric(view, base + yOff, fy.type, fy.size);
      positions[p * 3 + 2] = readNumeric(view, base + zOff, fz.type, fz.size);
      if (iOff >= 0 && fi) intensities[p] = readNumeric(view, base + iOff, fi.type, fi.size);
    }
    return { count, positions, intensities, hasIntensity: !!fi };
  }

  // binary_compressed: [uint32 compressedSize][uint32 uncompressedSize][LZF data].
  // Decompressed layout is FIELD-MAJOR (SoA): all x's, then all y's, ... not interleaved.
  const compView = new DataView(u8.buffer, u8.byteOffset + header.dataStart, u8.byteLength - header.dataStart);
  const compressedSize = compView.getUint32(0, true);
  const uncompressedSize = compView.getUint32(4, true);
  const compressed = u8.subarray(header.dataStart + 8, header.dataStart + 8 + compressedSize);
  const decompressed = lzfDecompress(compressed, uncompressedSize);
  view = new DataView(decompressed.buffer, decompressed.byteOffset, decompressed.byteLength);

  // Field-major offsets: each field occupies `count * size * count_n` contiguous bytes.
  const fieldStart = new Map<PcdField, number>();
  let acc = 0;
  for (const f of header.fields) {
    fieldStart.set(f, acc);
    acc += count * f.size * f.count;
  }
  const sx = fieldStart.get(fx)!;
  const sy = fieldStart.get(fy)!;
  const sz = fieldStart.get(fz)!;
  const si = fi ? fieldStart.get(fi)! : -1;
  for (let p = 0; p < count; p++) {
    positions[p * 3] = readNumeric(view, sx + p * fx.size, fx.type, fx.size);
    positions[p * 3 + 1] = readNumeric(view, sy + p * fy.size, fy.type, fy.size);
    positions[p * 3 + 2] = readNumeric(view, sz + p * fz.size, fz.type, fz.size);
    if (si >= 0 && fi) intensities[p] = readNumeric(view, si + p * fi.size, fi.type, fi.size);
  }
  return { count, positions, intensities, hasIntensity: !!fi };
}

// ============================================================================
// KITTI VELODYNE .bin
// ============================================================================

/**
 * Parse a KITTI Velodyne `.bin`: interleaved little-endian float32
 * `x y z intensity`, in the Velodyne frame (x-forward, y-left, z-up, meters;
 * intensity already normalized 0..1). This is the canonical real-LiDAR dump.
 */
export function parseKittiBin(buffer: ArrayBuffer | Uint8Array): RawCloud {
  const u8 = toU8(buffer);
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const count = Math.floor(u8.byteLength / 16); // 4 × float32
  const positions = new Float32Array(count * 3);
  const intensities = new Float32Array(count);
  for (let p = 0; p < count; p++) {
    const o = p * 16;
    positions[p * 3] = view.getFloat32(o, true);
    positions[p * 3 + 1] = view.getFloat32(o + 4, true);
    positions[p * 3 + 2] = view.getFloat32(o + 8, true);
    intensities[p] = view.getFloat32(o + 12, true);
  }
  return { count, positions, intensities, hasIntensity: true };
}

// ============================================================================
// DISPATCH
// ============================================================================

/** Recognized recorded-cloud extensions. */
export const SUPPORTED_POINTCLOUD_EXTENSIONS = ['.pcd', '.bin'] as const;

/**
 * Parse a recorded point-cloud buffer, choosing the format from the filename
 * (`.pcd` → PCD, `.bin` → KITTI Velodyne). Throws on an unknown extension.
 */
export function parsePointCloudFile(filename: string, buffer: ArrayBuffer | Uint8Array): RawCloud {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.pcd')) return parsePcd(buffer);
  if (lower.endsWith('.bin')) return parseKittiBin(buffer);
  // Fall back to sniffing: PCD files start with '#' or 'VERSION'/'FIELDS'.
  const head = TEXT_DECODER.decode(toU8(buffer).subarray(0, 16));
  if (head.startsWith('#') || head.startsWith('VERSION') || head.startsWith('FIELDS')) return parsePcd(buffer);
  throw new Error(`Unsupported point-cloud file: ${filename}`);
}
