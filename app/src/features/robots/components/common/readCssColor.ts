/**
 * @file readCssColor.ts
 * @description Resolve a CSS custom property to a literal color at runtime, for
 *   three.js / canvas materials that cannot take a `var(--…)` string.
 * @feature robots
 */

/** Read `varName` (e.g. '--color-primary') from the root element, or `fallback`. */
export function readCssColor(varName: string, fallback = 'currentColor'): string {
  if (typeof document === 'undefined') return fallback;
  try {
    const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    return value || fallback;
  } catch {
    return fallback;
  }
}
