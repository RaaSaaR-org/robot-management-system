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
  /** Expansion of the display name acronym (e.g., "Neo Data & Execution Management") */
  nameExpansion?: string;
  /** Short tagline (e.g., "Robot Management System") */
  tagline: string;
  /** Short marketing slogan used on the landing hero (e.g., "Bringing Intelligence to Motion") */
  shortSlogan?: string;
  /** Copyright holder (e.g., "EmAI Robotics GmbH") */
  copyright: string;
  /** Logo filename relative to brand/ folder (e.g., "logo.svg") */
  logo?: string;
  /**
   * Primary color scale -- replaces the default mint (bg-primary, text-primary,
   * primary-50..900 and the legacy cobalt-* aliases). Partial: only override
   * the shades you need. DEFAULT is the fill of primary buttons, links and the
   * focus ring, in both themes.
   */
  primaryColors?: Partial<ColorScale>;
  /**
   * Text/icon color on a primary fill (text-on-primary). Optional: when a brand
   * sets primaryColors without it, white or #0a2225 is picked, whichever
   * contrasts more with the primary DEFAULT.
   */
  onPrimary?: string;
  /** Accent color scale -- replaces the default teal (accent-*, legacy turquoise-*). */
  accentColors?: Partial<ColorScale>;
  /** Text/icon color on an accent fill (text-on-accent). Computed like onPrimary when omitted. */
  onAccent?: string;
  /** Dark mode surface/text/border overrides */
  darkOverrides?: ThemeSurfaceOverrides;
  /** Light mode surface/text/border overrides */
  lightOverrides?: ThemeSurfaceOverrides;
}
