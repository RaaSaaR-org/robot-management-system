/**
 * @file BrandProvider.tsx
 * @description React context provider that applies white-label brand config via CSS variable overrides
 * @feature brand
 */

import { createContext, useEffect, useMemo, type ReactNode } from 'react';
import type { ThemeSurfaceOverrides } from './types';
import { resolveBrand, type ResolvedBrand } from './resolve';
import { brandColorVars } from './brandVars';
import { useThemeStore } from '@/features/settings/store/themeStore';

// Load custom.css if it exists in the brand/ folder
const customCssModules = import.meta.glob('../../../brand/custom.css', { eager: true });
void customCssModules; // side-effect import only

export const BrandContext = createContext<ResolvedBrand>(resolveBrand());

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

  // Apply the primary/accent slot overrides (these don't change with theme).
  // Every primary-* / accent-* utility reads these slots, so the whole app
  // follows the brand.
  useEffect(() => {
    const root = document.documentElement.style;
    for (const [prop, value] of Object.entries(brandColorVars(brand))) {
      root.setProperty(prop, value);
    }
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
