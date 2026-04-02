/**
 * @file types.ts
 * @description White-label brand configuration types
 * @feature brand
 */

/** Color scale with 50-900 shades + DEFAULT */
export type ColorScale = Record<
  'DEFAULT' | '50' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900',
  string
>;

/** Surface, text, and border overrides for a theme mode (dark or light) */
export interface ThemeSurfaceOverrides {
  bgPrimary?: string;
  bgSecondary?: string;
  bgTertiary?: string;
  bgElevated?: string;
  bgCard?: string;
  textPrimary?: string;
  textSecondary?: string;
  textTertiary?: string;
  textMuted?: string;
  borderColor?: string;
  borderColorStrong?: string;
}

export interface BrandConfig {
  /** Display name shown in UI (e.g., "EmAI RMS", "ACME Robotics") */
  name: string;
  /** Short tagline (e.g., "Robot Management System") */
  tagline: string;
  /** Copyright holder (e.g., "EmAI Robotics GmbH") */
  copyright: string;
  /** Logo filename relative to brand/ folder (e.g., "logo.svg") */
  logo?: string;
  /** Primary color scale -- overrides cobalt (blue). Partial: only override shades you need. */
  primaryColors?: Partial<ColorScale>;
  /** Accent color scale -- overrides turquoise. Partial: only override shades you need. */
  accentColors?: Partial<ColorScale>;
  /** Dark mode surface/text/border overrides */
  darkOverrides?: ThemeSurfaceOverrides;
  /** Light mode surface/text/border overrides */
  lightOverrides?: ThemeSurfaceOverrides;
}
