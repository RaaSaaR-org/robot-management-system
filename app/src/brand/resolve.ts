/**
 * @file resolve.ts
 * @description Resolves the active brand config from brand/brand.config.ts or falls back to default
 * @feature brand
 */

import type { BrandConfig } from './types';
import { DEFAULT_BRAND } from './defaults';

let resolved: BrandConfig | null = null;

// import.meta.glob doesn't follow Vite aliases, so we use the relative path
// from this file (app/src/brand/) to the brand folder (../../../brand/ = repo root brand/)
const brandModules = import.meta.glob<{ default: BrandConfig }>(
  '../../../brand/brand.config.ts',
  { eager: true }
);

// Import logo files as URLs (Vite resolves them to asset paths)
const logoModules = import.meta.glob<string>(
  '../../../brand/logo.{svg,png,jpg,jpeg,webp}',
  { eager: true, import: 'default', query: '?url' }
);

function resolveLogoUrl(logoFilename?: string): string | undefined {
  if (!logoFilename) return undefined;
  // Find the matching logo in the glob results
  for (const [path, url] of Object.entries(logoModules)) {
    if (path.endsWith(`/${logoFilename}`)) {
      return url;
    }
  }
  return undefined;
}

export interface ResolvedBrand extends BrandConfig {
  /** Resolved logo URL (Vite asset path), ready for <img src> */
  logoUrl?: string;
}

/**
 * Quick access to resolved brand hex colors for non-Tailwind usage (3D scenes, SVG, canvas).
 * Falls back to default cobalt/turquoise if no brand override.
 */
export function brandColors() {
  const b = resolveBrand();
  return {
    primary: b.primaryColors?.DEFAULT ?? '#2A5FFF',
    primary500: b.primaryColors?.['500'] ?? b.primaryColors?.DEFAULT ?? '#2A5FFF',
    primary600: b.primaryColors?.['600'] ?? b.primaryColors?.DEFAULT ?? '#2A5FFF',
    accent: b.accentColors?.DEFAULT ?? '#18E4C3',
    accent500: b.accentColors?.['500'] ?? b.accentColors?.DEFAULT ?? '#18E4C3',
  };
}

export function resolveBrand(): ResolvedBrand {
  if (resolved) return resolved as ResolvedBrand;

  const mod = brandModules['../../../brand/brand.config.ts'];
  const config = mod?.default ?? DEFAULT_BRAND;
  const logoUrl = resolveLogoUrl(config.logo);

  resolved = { ...config, logoUrl } as ResolvedBrand;
  return resolved as ResolvedBrand;
}
