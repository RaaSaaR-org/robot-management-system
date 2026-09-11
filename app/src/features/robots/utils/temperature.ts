/**
 * @file temperature.ts
 * @description Motor-temperature warning scale shared by telemetry visualizations
 * @feature robots
 */

/** Motor temperature (°C) at which the warning color scale kicks in */
export const MOTOR_TEMP_WARNING_C = 60;
/** Motor temperature (°C) treated as critical (fully red) */
export const MOTOR_TEMP_CRITICAL_C = 75;
/** Lower anchor of the color scale — everything below is fully "ok" */
export const MOTOR_TEMP_OK_C = 35;

/**
 * Data-driven fill color for a motor temperature, built from the signal
 * tokens: measured (ok) below 35°C, blending to unknown (warm) at 60°C and
 * stopped (hot) at 75°C+. Returns a CSS `color-mix()` string for inline styles.
 *
 * @param tempC - Motor temperature in °C
 * @param alpha - Fill opacity (default 1)
 */
export function motorTempColor(tempC: number, alpha = 1): string {
  let base: string;
  if (tempC <= MOTOR_TEMP_OK_C) {
    base = 'var(--signal-measured)';
  } else if (tempC < MOTOR_TEMP_WARNING_C) {
    const t = Math.round(((tempC - MOTOR_TEMP_OK_C) / (MOTOR_TEMP_WARNING_C - MOTOR_TEMP_OK_C)) * 100);
    base = `color-mix(in oklab, var(--signal-unknown) ${t}%, var(--signal-measured))`;
  } else if (tempC < MOTOR_TEMP_CRITICAL_C) {
    const t = Math.round(((tempC - MOTOR_TEMP_WARNING_C) / (MOTOR_TEMP_CRITICAL_C - MOTOR_TEMP_WARNING_C)) * 100);
    base = `color-mix(in oklab, var(--signal-stopped) ${t}%, var(--signal-unknown))`;
  } else {
    base = 'var(--signal-stopped)';
  }
  if (alpha >= 1) return base;
  return `color-mix(in oklab, ${base} ${Math.round(alpha * 100)}%, transparent)`;
}

/** Text class for a motor temperature value (same ≥60°C warning scale) */
export function motorTempTextClass(tempC: number): string {
  if (tempC >= MOTOR_TEMP_CRITICAL_C) return 'text-signal-stopped';
  if (tempC >= MOTOR_TEMP_WARNING_C) return 'text-signal-unknown';
  return 'text-ink-secondary';
}
