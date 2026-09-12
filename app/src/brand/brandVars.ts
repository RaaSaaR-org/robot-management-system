/**
 * @file brandVars.ts
 * @description Turns a white-label brand's color slots into the CSS variables BrandProvider writes
 * @feature brand
 */

import type { BrandConfig, ColorScale } from './types';
import { DARK_ON_FILL } from './defaults';

const COLOR_SHADES = ['DEFAULT', '50', '100', '200', '300', '400', '500', '600', '700', '800', '900'] as const;

const WHITE = '#ffffff';

/** Parses #rgb, #rrggbb or rgb()/rgba() into 0-255 channels; null for anything else. */
function parseColor(color: string): [number, number, number] | null {
  const value = color.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const digits = hex[1].length === 3 ? hex[1].replace(/./g, (c) => c + c) : hex[1];
    return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16)) as [number, number, number];
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(value);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return null;
}

/** WCAG relative luminance of a color, or null when it cannot be parsed. */
export function relativeLuminance(color: string): number | null {
  const rgb = parseColor(color);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colors (1 when either cannot be parsed). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return 1;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The text color for a fill: white or the dark ink, whichever contrasts more.
 * An orange brand gets dark text (white on #FF6700 is 2.9:1), a navy one white.
 */
export function readableOn(fill: string): string {
  return contrastRatio(fill, WHITE) >= contrastRatio(fill, DARK_ON_FILL) ? WHITE : DARK_ON_FILL;
}

/** Writes one slot's scale; returns the effective DEFAULT (or undefined). */
function scaleVars(
  vars: Record<string, string>,
  slot: 'primary' | 'accent',
  scale: Partial<ColorScale> | undefined,
): string | undefined {
  if (!scale) return undefined;
  for (const shade of COLOR_SHADES) {
    const value = scale[shade];
    if (value) vars[shade === 'DEFAULT' ? `--color-${slot}` : `--color-${slot}-${shade}`] = value;
  }
  // DEFAULT and 500 stand in for each other when a brand gives only one.
  if (scale.DEFAULT && !scale['500']) vars[`--color-${slot}-500`] = scale.DEFAULT;
  if (scale['500'] && !scale.DEFAULT) vars[`--color-${slot}`] = scale['500'];
  return scale.DEFAULT ?? scale['500'];
}

/**
 * The CSS custom properties a brand overrides on <html>. Only the primary and
 * accent slots are brand-controlled; surfaces go through dark/lightOverrides
 * and the signal colors are never touched, so "stopped" means the same thing
 * on every deployment.
 *
 * A brand DEFAULT applies in both themes (the stock mint swaps to a deeper
 * green on light; a brand color is used as given). Hover is derived from it:
 * lighter for a light fill with dark text, darker for a dark fill with white.
 */
export function brandColorVars(
  brand: Pick<BrandConfig, 'primaryColors' | 'accentColors' | 'onPrimary' | 'onAccent'>,
): Record<string, string> {
  const vars: Record<string, string> = {};

  const primary = scaleVars(vars, 'primary', brand.primaryColors);
  if (primary) {
    const onPrimary = brand.onPrimary ?? readableOn(primary);
    vars['--color-on-primary'] = onPrimary;
    vars['--color-primary-hover'] =
      onPrimary === WHITE || contrastRatio(onPrimary, WHITE) < contrastRatio(onPrimary, DARK_ON_FILL)
        ? `color-mix(in srgb, ${primary} 85%, #000000)`
        : `color-mix(in srgb, ${primary} 78%, #ffffff)`;
  } else if (brand.onPrimary) {
    vars['--color-on-primary'] = brand.onPrimary;
  }

  const accent = scaleVars(vars, 'accent', brand.accentColors);
  if (accent || brand.onAccent) {
    vars['--color-on-accent'] = brand.onAccent ?? readableOn(accent as string);
  }

  return vars;
}
