/**
 * @file defaults.ts
 * @description Default brand config and color scales (the landing mint design)
 * @feature brand
 */

import type { BrandConfig, ColorScale } from './types';

/**
 * The default primary slot: the landing mint. DEFAULT is the dark-theme fill;
 * the light theme swaps it for a deeper green in index.css. A white-label brand
 * replaces the whole slot.
 */
export const PRIMARY_SCALE: ColorScale = {
  DEFAULT: '#b2f8df',
  '50': '#effef9',
  '100': '#d9fff1',
  '200': '#b2f8df',
  '300': '#8eeccb',
  '400': '#6bdcb6',
  '500': '#47c9a0',
  '600': '#2fa585',
  '700': '#22806a',
  '800': '#1a5e50',
  '900': '#123f37',
};

/** The default accent slot, a quieter teal next to the mint. */
export const ACCENT_SCALE: ColorScale = {
  DEFAULT: '#a9e6d8',
  '50': '#eefbf8',
  '100': '#d6f5ee',
  '200': '#a9e6d8',
  '300': '#7fd4c3',
  '400': '#56bfad',
  '500': '#3aa695',
  '600': '#2b877a',
  '700': '#226b61',
  '800': '#1a514a',
  '900': '#123833',
};

/** The dark ink used on light fills (text-on-primary over the default mint). */
export const DARK_ON_FILL = '#0a2225';

export const DEFAULT_BRAND: BrandConfig = {
  name: 'NeoDEM',
  nameExpansion: 'Neo Data & Execution Management',
  tagline: 'Fleet Management System',
  shortSlogan: 'Bringing Intelligence to Motion',
  copyright: 'NeoDEM Contributors',
};
