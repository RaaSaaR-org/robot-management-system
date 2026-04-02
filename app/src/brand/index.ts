/**
 * @file index.ts
 * @description Barrel exports for the white-label brand system
 * @feature brand
 */

export { BrandProvider } from './BrandProvider';
export { useBrand } from './useBrand';
export { resolveBrand, brandColors } from './resolve';
export type { ResolvedBrand } from './resolve';
export type { BrandConfig, ColorScale, ThemeSurfaceOverrides } from './types';
