/**
 * @file VrTextPlate.tsx
 * @description Draws short lines of text onto a `THREE.CanvasTexture` so they
 *              can be hung in the XR scene as a plane. Shared by the wrist HUD
 *              and the head-camera panel's status plates.
 * @feature robots
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

/** One line of plate text. `id` is not drawn — it is the caller's stable key. */
export interface TextPlateLine {
  id: string;
  text: string;
  color: string;
  /** Heavier weight — the robot panel's why line. */
  bold?: boolean;
  /**
   * Break onto further rows at word boundaries instead of overflowing. A line
   * that is not wrapped and still too wide is shrunk to fit (down to 60 %).
   */
  wrap?: boolean;
  /**
   * With `wrap`: at most this many rows (TASK-418 — the board's task line takes
   * two). The last kept row ends in an ellipsis when text was cut.
   */
  maxRows?: number;
  /**
   * Glyph and row height relative to the plate's `linePx` (TASK-417: the
   * robot panel's why line is 1.5x). Default 1.
   */
  scale?: number;
}

/** Per-draw extras (TASK-407): the button states and the latched panel. */
export interface TextPlateDrawOptions {
  /** Replaces the plate's backdrop for this draw. */
  background?: string;
  /** A border in this colour — hover, or a panel that wants attention. */
  highlight?: string;
  /** A fill bar along the bottom edge, `fraction` 0..1 — hold-to-confirm. */
  fill?: { fraction: number; color: string };
}

export interface TextPlateOptions {
  /** Texture size in pixels. Powers of two, so mipmapping stays cheap. */
  pxWidth: number;
  pxHeight: number;
  /** Line height in pixels; the glyph size is 0.72 of it. */
  linePx?: number;
  /** Backdrop behind the text. Semi-transparent, so the scene shows through. */
  background?: string;
  align?: 'left' | 'center';
}

export interface TextPlate {
  /** Null when this browser gave us no 2D context (jsdom, a lost GPU). */
  texture: THREE.CanvasTexture | null;
  /** Repaint. A no-op when the text, colours and options are unchanged. */
  draw: (lines: readonly TextPlateLine[], options?: TextPlateDrawOptions) => void;
}

/**
 * FONT: a system stack and nothing else.
 *
 * `drei`'s `<Text>` (troika) is the obvious way to put text in an R3F scene and
 * is the wrong tool here: it resolves a font FILE over the network at first
 * paint. This HUD's entire reason to exist is to be readable on a headset whose
 * link to the operator's workstation has just died — the one moment a font fetch
 * cannot complete. A 2D canvas with a system font has no such dependency, and
 * `fillText` costs one upload of a 512x256 texture a few times a second.
 */
const FONT_STACK = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/**
 * A canvas-backed text plate.
 *
 * `draw` is imperative on purpose: the callers run inside `useFrame` at headset
 * frame rate, and turning every status change into React state would re-render
 * the R3F tree 72-120 times a second. The signature check inside `draw` means
 * calling it every frame costs one string compare when nothing changed.
 */
export function useTextPlate(options: TextPlateOptions): TextPlate {
  const { pxWidth, pxHeight, linePx = 44, background = 'rgba(9,11,17,0.82)', align = 'left' } = options;
  const lastSignature = useRef('');

  const plate = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = pxWidth;
    canvas.height = pxHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { texture: null, ctx: null };
    const texture = new THREE.CanvasTexture(canvas);
    // The text is UI, not lit geometry: sRGB so the colours are the ones the
    // HUD palette names, and no tone mapping to crush them afterwards.
    texture.colorSpace = THREE.SRGBColorSpace;
    return { texture, ctx };
  }, [pxWidth, pxHeight]);

  useEffect(() => () => plate.texture?.dispose(), [plate]);

  // `useCallback`/`useMemo` so the returned handle is REFERENTIALLY STABLE:
  // callers put it in effect dependency arrays, and a fresh object per render
  // would re-run those effects on every state change in the component above.
  const draw = useCallback((lines: readonly TextPlateLine[], options?: TextPlateDrawOptions): void => {
    const { texture, ctx } = plate;
    if (!texture || !ctx) return;
    const fill = options?.fill;
    const signature = lines
      .map((l) => `${l.id}\u0000${l.text}\u0000${l.color}\u0000${l.bold ? 1 : 0}${l.wrap ? 1 : 0}${l.maxRows ?? ''}\u0000${l.scale ?? 1}`)
      .join('\u0001')
      + `\u0002${options?.background ?? ''}\u0002${options?.highlight ?? ''}`
      + `\u0002${fill ? `${fill.fraction.toFixed(3)} ${fill.color}` : ''}`;
    if (signature === lastSignature.current) return;
    lastSignature.current = signature;

    ctx.clearRect(0, 0, pxWidth, pxHeight);
    ctx.fillStyle = options?.background ?? background;
    ctx.fillRect(0, 0, pxWidth, pxHeight);

    if (fill && fill.fraction > 0) {
      // Along the bottom edge, left to right: the hold-to-confirm bar.
      const h = Math.max(6, Math.round(pxHeight * 0.22));
      ctx.fillStyle = fill.color;
      ctx.fillRect(0, pxHeight - h, Math.round(pxWidth * Math.min(1, fill.fraction)), h);
    }
    if (options?.highlight) {
      const w = Math.max(4, Math.round(Math.min(pxWidth, pxHeight) * 0.05));
      ctx.strokeStyle = options.highlight;
      ctx.lineWidth = w;
      ctx.strokeRect(w / 2, w / 2, pxWidth - w, pxHeight - w);
    }

    const glyph = Math.round(linePx * 0.72);
    const fontFor = (bold: boolean, px: number): string => `${bold ? 800 : 600} ${px}px ${FONT_STACK}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = align === 'center' ? 'center' : 'left';
    const margin = Math.round(linePx * 0.45);
    const x = align === 'center' ? pxWidth / 2 : margin;
    const maxWidth = pxWidth - 2 * margin;

    // Lay the lines out as ROWS first: a wrapped line can take several.
    const rows: Array<{ text: string; color: string; font: string; height: number }> = [];
    for (const line of lines) {
      const scale = line.scale !== undefined && Number.isFinite(line.scale) && line.scale > 0 ? line.scale : 1;
      const lineGlyph = Math.round(glyph * scale);
      const height = Math.round(linePx * scale);
      const font = fontFor(line.bold === true, lineGlyph);
      ctx.font = font;
      if (line.wrap && ctx.measureText(line.text).width > maxWidth) {
        const wrapped: string[] = [];
        let current = '';
        for (const word of line.text.split(' ')) {
          const next = current ? `${current} ${word}` : word;
          if (current && ctx.measureText(next).width > maxWidth) {
            wrapped.push(current);
            current = word;
          } else {
            current = next;
          }
        }
        if (current) wrapped.push(current);
        const limit = line.maxRows !== undefined && line.maxRows > 0 ? line.maxRows : wrapped.length;
        if (wrapped.length > limit) {
          wrapped.length = limit;
          let last = `${wrapped[limit - 1]}…`;
          while (last.length > 1 && ctx.measureText(last).width > maxWidth) last = `${last.slice(0, -2)}…`;
          wrapped[limit - 1] = last;
        }
        for (const text of wrapped) rows.push({ text, color: line.color, font, height });
        continue;
      }
      // Too wide and not wrapped: shrink it rather than cut it off.
      const width = ctx.measureText(line.text).width;
      const px = width > maxWidth
        ? Math.max(Math.round(lineGlyph * 0.6), Math.floor(lineGlyph * (maxWidth / width)))
        : lineGlyph;
      rows.push({ text: line.text, color: line.color, font: fontFor(line.bold === true, px), height });
    }

    // Vertically centre the block, so a two-line E-Stop banner does not sit in
    // the top half of the plate with nothing under it.
    const total = rows.reduce((sum, row) => sum + row.height, 0);
    let y = (pxHeight - total) / 2;
    for (const row of rows) {
      ctx.font = row.font;
      ctx.fillStyle = row.color;
      ctx.fillText(row.text, x, y + row.height / 2);
      y += row.height;
    }
    texture.needsUpdate = true;
  }, [plate, pxWidth, pxHeight, linePx, background, align]);

  return useMemo(() => ({ texture: plate.texture, draw }), [plate, draw]);
}
