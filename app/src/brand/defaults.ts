/**
 * @file defaults.ts
 * @description Default brand config and color scales (current NeoDEM blue design)
 * @feature brand
 */

import type { BrandConfig, ColorScale } from './types';

export const COBALT_SCALE: ColorScale = {
  DEFAULT: '#2A5FFF',
  '50': '#E8EDFF',
  '100': '#D1DBFF',
  '200': '#A3B7FF',
  '300': '#7593FF',
  '400': '#476FFF',
  '500': '#2A5FFF',
  '600': '#0042E6',
  '700': '#0032B3',
  '800': '#002280',
  '900': '#00124D',
};

export const TURQUOISE_SCALE: ColorScale = {
  DEFAULT: '#18E4C3',
  '50': '#E6FCF8',
  '100': '#CCF9F1',
  '200': '#99F3E3',
  '300': '#66EDD5',
  '400': '#33E7C7',
  '500': '#18E4C3',
  '600': '#12B89C',
  '700': '#0D8B76',
  '800': '#095E4F',
  '900': '#043129',
};

export const DEFAULT_BRAND: BrandConfig = {
  name: 'NeoDEM',
  nameExpansion: 'Neo Data & Execution Management',
  tagline: 'Fleet Management System',
  shortSlogan: 'Bringing Intelligence to Motion',
  copyright: 'NeoDEM Contributors',
};
