/**
 * @file simColors.ts
 * @description Colours of the safety simulation preview, taken from the theme's
 *              CSS variables. SVG uses the `var(--…)` strings directly; three.js
 *              materials cannot read CSS, so `readSimColors()` resolves the same
 *              variables once via getComputedStyle.
 * @feature command
 */

import type { SimulationSafetyStatus } from '../types/simulation.types';

/** CSS variable behind each role of the simulation (see docs/brand.md tokens) */
export const SIM_COLOR_VARS = {
  primary: '--color-primary',
  accent: '--color-accent',
  measured: '--signal-measured',
  estimated: '--signal-estimated',
  unknown: '--signal-unknown',
  stopped: '--signal-stopped',
  ground: '--bg-tertiary',
  panel: '--bg-secondary',
  line: '--border-color',
  lineStrong: '--border-color-strong',
  muted: '--text-muted',
} as const;

export type SimColorRole = keyof typeof SIM_COLOR_VARS;

/** `var(--…)` strings for SVG fill/stroke and style props */
export const SIM_COLORS = Object.fromEntries(
  Object.entries(SIM_COLOR_VARS).map(([role, name]) => [role, `var(${name})`])
) as Record<SimColorRole, string>;

/** Role that colours the path for each safety classification */
export const SAFETY_STATUS_ROLE: Record<SimulationSafetyStatus, SimColorRole> = {
  safe: 'measured',
  caution: 'unknown',
  dangerous: 'stopped',
};

/**
 * Resolve every simulation colour to a concrete value for three.js.
 * Call inside a component (after mount); falls back to neutral grey outside a browser.
 */
export function readSimColors(): Record<SimColorRole, string> {
  const style =
    typeof document !== 'undefined' ? getComputedStyle(document.documentElement) : null;
  return Object.fromEntries(
    Object.entries(SIM_COLOR_VARS).map(([role, name]) => {
      const value = style?.getPropertyValue(name).trim();
      return [role, value || 'grey'];
    })
  ) as Record<SimColorRole, string>;
}
