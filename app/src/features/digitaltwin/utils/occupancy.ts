/**
 * @file occupancy.ts
 * @description Client-side decoder for a twin's occupancy grid (binary P5 PGM,
 *   ROS map_server convention: 0=occupied, 254=free, 205=unknown). Browsers
 *   can't render PGM in an `<img>`, so we parse the P5 header + bytes and paint
 *   a theme-aware RGBA PNG (walls bright, free transparent) for use as a gallery
 *   thumbnail and as the underlay in the zone-authoring editor.
 * @feature digitaltwin
 */

import { useEffect, useState } from 'react';
import { twinApi } from '../api/twinApi';

export interface PgmImage {
  width: number;
  height: number;
  maxVal: number;
  /** Row-major grayscale bytes (length = width * height). */
  pixels: Uint8Array;
}

const WS = (b: number) => b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d;

/** Parse a binary (P5) PGM. Throws on a malformed header. */
export function parsePgmP5(buffer: ArrayBuffer): PgmImage {
  const buf = new Uint8Array(buffer);
  if (buf.length < 2 || buf[0] !== 0x50 /* P */ || buf[1] !== 0x35 /* 5 */) {
    throw new Error('Not a binary (P5) PGM');
  }
  let pos = 2;
  const nextToken = (): string => {
    while (pos < buf.length) {
      if (WS(buf[pos])) { pos++; continue; }
      if (buf[pos] === 0x23 /* # */) { while (pos < buf.length && buf[pos] !== 0x0a) pos++; continue; }
      break;
    }
    const start = pos;
    while (pos < buf.length && !WS(buf[pos]) && buf[pos] !== 0x23) pos++;
    return String.fromCharCode(...buf.subarray(start, pos));
  };
  const width = parseInt(nextToken(), 10);
  const height = parseInt(nextToken(), 10);
  const maxVal = parseInt(nextToken(), 10);
  pos++; // exactly one whitespace separates the header from the raster
  const pixels = buf.subarray(pos, pos + width * height);
  return { width, height, maxVal, pixels };
}

// Value bands (ROS occupancy). Walls render bright so obstacles are crisp; the
// navigable floor gets a faint turquoise wash; unknown is barely a haze so the
// (often sparse) unscanned cells don't read as speckle/noise.
const OCCUPIED_MAX = 64;
const FREE_MIN = 230;

/** Render a parsed PGM to a theme-aware PNG data URL (walls light, floor faint). */
export function pgmToDataUrl(img: PgmImage): string {
  const { width, height, pixels } = img;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const out = ctx.createImageData(width, height);
  for (let i = 0; i < width * height; i++) {
    const v = pixels[i] ?? 205;
    let r = 0, g = 0, b = 0, a = 0;
    if (v <= OCCUPIED_MAX) {
      r = 226; g = 232; b = 240; a = 255; // wall — bright slate-200
    } else if (v >= FREE_MIN) {
      r = 45; g = 212; b = 191; a = 44; // free floor — faint turquoise
    } else {
      r = 71; g = 85; b = 105; a = 28; // unknown — barely-there haze
    }
    const o = i * 4;
    out.data[o] = r;
    out.data[o + 1] = g;
    out.data[o + 2] = b;
    out.data[o + 3] = a;
  }
  ctx.putImageData(out, 0, 0);
  return canvas.toDataURL('image/png');
}

export interface OccupancyImage {
  url: string;
  width: number;
  height: number;
}

/**
 * Fetch + decode a twin's occupancy grid into a renderable PNG data URL. Returns
 * null while loading, when disabled, or if the artifact isn't reachable yet.
 */
export function useOccupancyImage(twinId: string, enabled: boolean): OccupancyImage | null {
  const [image, setImage] = useState<OccupancyImage | null>(null);
  useEffect(() => {
    if (!enabled || !twinId) {
      setImage(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const buffer = await twinApi.getOccupancyPgm(twinId);
        const img = parsePgmP5(buffer);
        if (cancelled) return;
        const url = pgmToDataUrl(img);
        if (url) setImage({ url, width: img.width, height: img.height });
      } catch {
        if (!cancelled) setImage(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [twinId, enabled]);
  return image;
}
