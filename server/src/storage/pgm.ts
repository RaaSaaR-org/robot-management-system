/**
 * @file pgm.ts
 * @description Binary (P5) PGM reader + writer, the ONE world-meters → pixel
 *              transform shared by occupancy generation and keep-out
 *              rasterization, and a polygon scan-fill. Pure + unit-testable.
 * @feature digitaltwin
 *
 * ## Coordinate transform (the whole game — see CONTRACT.md)
 * A grid models a world-frame rectangle anchored at `(originX, originY)` (the
 * bottom-left corner, in meters) with square pixels of side `resolution`
 * (meters/pixel). World point `(wx, wy)` maps to a pixel as:
 *
 *   col = round((wx - originX) / resolution)
 *   rowFromBottom = round((wy - originY) / resolution)
 *   row = (height - 1) - rowFromBottom        // flip Y: image row 0 = top
 *
 * This matches the ROS map_server / Nav2 convention where the YAML `origin`
 * is the real-world pose of the bottom-left pixel and image rows grow
 * downward. Occupancy generation and zone rasterization MUST use this same
 * transform so masks line up pixel-perfect with the occupancy grid.
 */

// ============================================================================
// TYPES
// ============================================================================

/** A binary occupancy/grayscale grid. `data` is row-major, length w*h, 0..maxVal. */
export interface PgmGrid {
  width: number;
  height: number;
  maxVal: number;
  data: Uint8Array;
}

/** Anchor describing how a grid maps to the world frame. */
export interface GridTransform {
  /** World X (meters) of the grid's bottom-left pixel. */
  originX: number;
  /** World Y (meters) of the grid's bottom-left pixel. */
  originY: number;
  /** Meters per pixel. */
  resolution: number;
  /** Grid height in pixels (needed for the row flip). */
  height: number;
}

/** A pixel coordinate (column, row). */
export interface PixelXY {
  px: number;
  py: number;
}

// ============================================================================
// TRANSFORM
// ============================================================================

/**
 * Convert a world-frame point (meters) to integer pixel coordinates.
 * Documented transform — the single source of truth for px/py mapping.
 */
export function worldToPixel(wx: number, wy: number, t: GridTransform): PixelXY {
  const col = Math.round((wx - t.originX) / t.resolution);
  const rowFromBottom = Math.round((wy - t.originY) / t.resolution);
  const row = t.height - 1 - rowFromBottom;
  return { px: col, py: row };
}

// ============================================================================
// GRID CONSTRUCTION
// ============================================================================

/** Allocate a grid filled with a single value (default 0). */
export function createGrid(width: number, height: number, fill = 0, maxVal = 255): PgmGrid {
  const data = new Uint8Array(width * height);
  if (fill !== 0) data.fill(fill);
  return { width, height, maxVal, data };
}

// ============================================================================
// POLYGON SCAN-FILL
// ============================================================================

/**
 * Scan-fill a closed polygon (given in PIXEL coordinates) into the grid,
 * setting every interior + boundary pixel to `value`. Uses the even-odd rule
 * with a standard scanline algorithm. The polygon need not be closed
 * explicitly (the last vertex is joined to the first).
 */
export function fillPolygon(grid: PgmGrid, polygonPx: PixelXY[], value: number): void {
  const n = polygonPx.length;
  if (n < 3) return;

  // Vertical bounds clamped to the grid.
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of polygonPx) {
    if (p.py < minY) minY = p.py;
    if (p.py > maxY) maxY = p.py;
  }
  const yStart = Math.max(0, Math.ceil(minY));
  const yEnd = Math.min(grid.height - 1, Math.floor(maxY));

  for (let y = yStart; y <= yEnd; y++) {
    // Sample scanlines through pixel centers (y + 0.5) so horizontal edges
    // and shared vertices are handled deterministically.
    const yc = y + 0.5;
    const crossings: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = polygonPx[i];
      const b = polygonPx[(i + 1) % n];
      const ay = a.py;
      const by = b.py;
      // Edge straddles the scanline?
      if ((ay <= yc && by > yc) || (by <= yc && ay > yc)) {
        const t = (yc - ay) / (by - ay);
        crossings.push(a.px + t * (b.px - a.px));
      }
    }
    if (crossings.length < 2) continue;
    crossings.sort((p, q) => p - q);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const xStart = Math.max(0, Math.ceil(crossings[k] - 0.5));
      const xEnd = Math.min(grid.width - 1, Math.floor(crossings[k + 1] - 0.5));
      for (let x = xStart; x <= xEnd; x++) {
        grid.data[y * grid.width + x] = value;
      }
    }
  }
}

// ============================================================================
// PGM ENCODE / DECODE (P5 binary)
// ============================================================================

/**
 * Encode a grid as a binary (P5) PGM image.
 */
export function encodePgm(grid: PgmGrid): Buffer {
  const header = `P5\n${grid.width} ${grid.height}\n${grid.maxVal}\n`;
  const headerBuf = Buffer.from(header, 'ascii');
  const body = Buffer.from(grid.data.buffer, grid.data.byteOffset, grid.data.byteLength);
  return Buffer.concat([headerBuf, body]);
}

/**
 * Decode a binary (P5) PGM image. Throws on malformed input.
 * Tolerates comment lines (`# ...`) and arbitrary whitespace in the header.
 */
export function decodePgm(buf: Buffer): PgmGrid {
  if (buf.length < 2 || buf[0] !== 0x50 /* P */ || buf[1] !== 0x35 /* 5 */) {
    throw new Error('Not a binary (P5) PGM');
  }

  let pos = 2;
  const tokens: number[] = [];
  while (tokens.length < 3 && pos < buf.length) {
    // Skip whitespace.
    while (pos < buf.length && isWhitespace(buf[pos])) pos++;
    // Skip comment lines.
    if (buf[pos] === 0x23 /* # */) {
      while (pos < buf.length && buf[pos] !== 0x0a) pos++;
      continue;
    }
    // Read a numeric token.
    let start = pos;
    while (pos < buf.length && !isWhitespace(buf[pos])) pos++;
    if (pos > start) {
      tokens.push(parseInt(buf.toString('ascii', start, pos), 10));
    }
  }

  if (tokens.length < 3) throw new Error('Malformed PGM header');
  const [width, height, maxVal] = tokens;
  // Exactly one whitespace byte separates the header from the raster.
  pos += 1;
  const expected = width * height;
  const data = new Uint8Array(expected);
  for (let i = 0; i < expected && pos + i < buf.length; i++) {
    data[i] = buf[pos + i];
  }
  return { width, height, maxVal, data };
}

function isWhitespace(byte: number): boolean {
  return byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d;
}
