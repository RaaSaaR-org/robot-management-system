/**
 * @file useBrand.ts
 * @description Hook to access the active brand configuration
 * @feature brand
 */

import { useContext } from 'react';
import { BrandContext } from './BrandProvider';
import type { ResolvedBrand } from './resolve';

export function useBrand(): ResolvedBrand {
  return useContext(BrandContext);
}
