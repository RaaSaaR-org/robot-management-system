/**
 * @file brand.test.ts
 * @description The default product tagline, and that the browser title built in
 *              vite.config.ts says the same thing (TASK-495)
 * @feature brand
 */

import { describe, it, expect } from 'vitest';
import viteConfigSource from '../../../vite.config.ts?raw';
import { DEFAULT_BRAND } from '../defaults';

describe('the default brand', () => {
  it('calls the product an open Physical AI platform, not a fleet management system', () => {
    expect(DEFAULT_BRAND.name).toBe('NeoDEM');
    expect(DEFAULT_BRAND.tagline).toBe('Open Physical AI Platform');
    expect(JSON.stringify(DEFAULT_BRAND)).not.toMatch(/Fleet Management/i);
  });

  it('is the tagline the browser title falls back to', () => {
    // vite.config.ts cannot import the app's sources, so it repeats the default.
    expect(viteConfigSource).toContain(`let brandTagline = '${DEFAULT_BRAND.tagline}';`);
  });
});
