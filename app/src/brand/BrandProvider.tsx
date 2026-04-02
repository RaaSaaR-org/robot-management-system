/**
 * @file BrandProvider.tsx
 * @description React context provider that applies white-label brand config via CSS variable overrides
 * @feature brand
 */

import { createContext, useEffect, useMemo, type ReactNode } from 'react';
import type { ColorScale, ThemeSurfaceOverrides } from './types';
import { resolveBrand, type ResolvedBrand } from './resolve';
import { useThemeStore } from '@/features/settings/store/themeStore';

// Load custom.css if it exists in the brand/ folder
const customCssModules = import.meta.glob('../../../brand/custom.css', { eager: true });
void customCssModules; // side-effect import only

export const BrandContext = createContext<ResolvedBrand>(resolveBrand());

const COLOR_SHADES = ['DEFAULT', '50', '100', '200', '300', '400', '500', '600', '700', '800', '900'] as const;

function applyColorScale(
  root: CSSStyleDeclaration,
  prefix: string,
  brandColors: Partial<ColorScale> | undefined,
) {
  if (!brandColors) return;

  for (const shade of COLOR_SHADES) {
    const value = brandColors[shade];
    if (value) {
      const prop = shade === 'DEFAULT' ? `--color-${prefix}` : `--color-${prefix}-${shade}`;
      root.setProperty(prop, value);
    }
  }

  // If DEFAULT is set but 500 isn't, sync them (500 is the Tailwind default shade)
  if (brandColors.DEFAULT && !brandColors['500']) {
    root.setProperty(`--color-${prefix}-500`, brandColors.DEFAULT);
  }
  if (brandColors['500'] && !brandColors.DEFAULT) {
    root.setProperty(`--color-${prefix}`, brandColors['500']);
  }
}

const SURFACE_VAR_MAP: Record<keyof ThemeSurfaceOverrides, string> = {
  bgPrimary: '--bg-primary',
  bgSecondary: '--bg-secondary',
  bgTertiary: '--bg-tertiary',
  bgElevated: '--bg-elevated',
  bgCard: '--bg-card',
  textPrimary: '--text-primary',
  textSecondary: '--text-secondary',
  textTertiary: '--text-tertiary',
  textMuted: '--text-muted',
  borderColor: '--border-color',
  borderColorStrong: '--border-color-strong',
};

function applySurfaceOverrides(root: CSSStyleDeclaration, overrides: ThemeSurfaceOverrides | undefined) {
  for (const [key, cssVar] of Object.entries(SURFACE_VAR_MAP)) {
    const value = overrides?.[key as keyof ThemeSurfaceOverrides];
    if (value) {
      root.setProperty(cssVar, value);
    } else {
      // Remove inline override so stylesheet default takes effect
      root.removeProperty(cssVar);
    }
  }
}

function isDarkMode(theme: string): boolean {
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  // system: check OS preference
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function BrandProvider({ children }: { children: ReactNode }) {
  const brand = useMemo(() => resolveBrand(), []);
  const theme = useThemeStore((s) => s.theme);

  // Apply color scale overrides (these don't change with theme)
  useEffect(() => {
    const root = document.documentElement.style;
    applyColorScale(root, 'cobalt', brand.primaryColors);
    applyColorScale(root, 'turquoise', brand.accentColors);
  }, [brand]);

  // Apply surface overrides (theme-dependent)
  useEffect(() => {
    const root = document.documentElement.style;
    const dark = isDarkMode(theme);
    const overrides = dark ? brand.darkOverrides : brand.lightOverrides;

    // Only apply if the brand has any surface overrides at all
    if (brand.darkOverrides || brand.lightOverrides) {
      applySurfaceOverrides(root, overrides);
    }
  }, [brand, theme]);

  return (
    <BrandContext.Provider value={brand}>
      {children}
    </BrandContext.Provider>
  );
}
