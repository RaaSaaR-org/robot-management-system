/**
 * @file brandVars.test.ts
 * @description Tests for the white-label color math: readable on-colors and the CSS vars a brand writes
 * @feature brand
 */

import { describe, it, expect } from 'vitest';
import { brandColorVars, contrastRatio, readableOn, relativeLuminance } from '../brandVars';
import { DARK_ON_FILL, PRIMARY_SCALE } from '../defaults';

describe('contrast math', () => {
  it('computes WCAG luminance and contrast', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5);
    expect(relativeLuminance('#000')).toBeCloseTo(0, 5);
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 1);
    expect(contrastRatio('rgb(255, 255, 255)', '#000')).toBeCloseTo(21, 1);
  });

  it('treats an unparseable color as no contrast', () => {
    expect(relativeLuminance('oklch(70% 0.1 150)')).toBeNull();
    expect(contrastRatio('oklch(70% 0.1 150)', '#fff')).toBe(1);
  });
});

describe('readableOn', () => {
  it('puts dark text on light fills (mint, orange)', () => {
    expect(readableOn(PRIMARY_SCALE.DEFAULT)).toBe(DARK_ON_FILL);
    expect(readableOn('#FF6700')).toBe(DARK_ON_FILL);
  });

  it('puts white text on dark fills (cobalt, navy, the light-theme green)', () => {
    expect(readableOn('#2A5FFF')).toBe('#ffffff');
    expect(readableOn('#0C1440')).toBe('#ffffff');
    expect(readableOn('#0f7a60')).toBe('#ffffff');
  });

  it('always lands at AA or better for a saturated brand hue', () => {
    for (const fill of ['#FF6700', '#2A5FFF', '#E11D48', '#FACC15', '#7C3AED']) {
      expect(contrastRatio(fill, readableOn(fill))).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('brandColorVars', () => {
  it('writes nothing for a text-only brand', () => {
    expect(brandColorVars({})).toEqual({});
  });

  it('writes the primary slot, mirrors DEFAULT into 500, and derives on-primary and hover', () => {
    const vars = brandColorVars({ primaryColors: { DEFAULT: '#FF6700', '600': '#CC5200' } });
    expect(vars['--color-primary']).toBe('#FF6700');
    expect(vars['--color-primary-500']).toBe('#FF6700');
    expect(vars['--color-primary-600']).toBe('#CC5200');
    expect(vars['--color-on-primary']).toBe(DARK_ON_FILL);
    // Light fill with dark text: hover lightens.
    expect(vars['--color-primary-hover']).toBe('color-mix(in srgb, #FF6700 78%, #ffffff)');
  });

  it('darkens the hover of a dark primary that carries white text', () => {
    const vars = brandColorVars({ primaryColors: { '500': '#2A5FFF' } });
    expect(vars['--color-primary']).toBe('#2A5FFF');
    expect(vars['--color-on-primary']).toBe('#ffffff');
    expect(vars['--color-primary-hover']).toBe('color-mix(in srgb, #2A5FFF 85%, #000000)');
  });

  it('respects an explicit onPrimary / onAccent', () => {
    const vars = brandColorVars({
      primaryColors: { DEFAULT: '#FF6700' },
      onPrimary: '#1a0d00',
      accentColors: { DEFAULT: '#0F766E' },
      onAccent: '#f0fdfa',
    });
    expect(vars['--color-on-primary']).toBe('#1a0d00');
    expect(vars['--color-accent']).toBe('#0F766E');
    expect(vars['--color-on-accent']).toBe('#f0fdfa');
  });

  it('computes on-accent from the accent DEFAULT', () => {
    expect(brandColorVars({ accentColors: { DEFAULT: '#2DD4BF' } })['--color-on-accent']).toBe(DARK_ON_FILL);
  });

  it('never touches the signal colors or the legacy cobalt/turquoise names', () => {
    const vars = brandColorVars({
      primaryColors: { DEFAULT: '#FF6700' },
      accentColors: { DEFAULT: '#2DD4BF' },
    });
    for (const key of Object.keys(vars)) {
      expect(key).toMatch(/^--color-(primary|accent|on-primary|on-accent)/);
    }
  });
});
