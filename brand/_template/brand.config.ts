/**
 * White-label brand configuration.
 *
 * Copy this file to brand/brand.config.ts and customize it.
 * See app/src/brand/types.ts for the full BrandConfig interface.
 */

import type { BrandConfig } from '../app/src/brand/types';

const brand: BrandConfig = {
  // ── Required ────────────────────────────────────────────────────────────
  name: 'Your Company',
  tagline: 'Robot Management System',
  copyright: 'Your Company GmbH',

  // ── Logo (optional) ────────────────────────────────────────────────────
  // Place your logo file next to this config (e.g., brand/logo.svg)
  // logo: 'logo.svg',

  // ── Primary Color (optional) ───────────────────────────────────────────
  // Overrides cobalt blue. Provide a full scale or just DEFAULT + a few shades.
  // primaryColors: {
  //   DEFAULT: '#FF6700',
  //   '50':  '#FFF3E8',
  //   '100': '#FFE0C2',
  //   '200': '#FFC285',
  //   '300': '#FFA366',
  //   '400': '#FF8534',
  //   '500': '#FF6700',
  //   '600': '#CC5200',
  //   '700': '#993D00',
  //   '800': '#662900',
  //   '900': '#331400',
  // },

  // ── Accent Color (optional) ────────────────────────────────────────────
  // Overrides turquoise. Same format as primaryColors.
  // accentColors: {
  //   DEFAULT: '#2DD4BF',
  //   '50':  '#F0FDFA',
  //   '100': '#CCFBF1',
  //   '200': '#99F6E4',
  //   '300': '#5EEAD4',
  //   '400': '#2DD4BF',
  //   '500': '#14B8A6',
  //   '600': '#0D9488',
  //   '700': '#0F766E',
  //   '800': '#115E59',
  //   '900': '#134E4A',
  // },

  // ── Dark Mode Surfaces (optional) ──────────────────────────────────────
  // darkOverrides: {
  //   bgPrimary: '#141414',
  //   bgSecondary: '#1F1F1F',
  //   bgTertiary: '#0D0D0D',
  //   bgElevated: '#292929',
  //   bgCard: '#1F1F1F',
  //   textPrimary: '#F5F5F4',
  //   textSecondary: '#A8A29E',
  //   textTertiary: '#78716C',
  //   textMuted: '#57534E',
  //   borderColor: 'rgba(255, 255, 255, 0.08)',
  //   borderColorStrong: 'rgba(255, 255, 255, 0.15)',
  // },

  // ── Light Mode Surfaces (optional) ─────────────────────────────────────
  // lightOverrides: {
  //   bgPrimary: '#FAFAF9',
  //   bgSecondary: '#F5F5F4',
  //   bgTertiary: '#E7E5E4',
  //   bgElevated: '#FFFFFF',
  //   bgCard: '#FFFFFF',
  //   textPrimary: '#1C1917',
  //   textSecondary: '#44403C',
  //   textTertiary: '#78716C',
  //   textMuted: '#A8A29E',
  //   borderColor: 'rgba(0, 0, 0, 0.08)',
  //   borderColorStrong: 'rgba(0, 0, 0, 0.15)',
  // },
};

export default brand;
