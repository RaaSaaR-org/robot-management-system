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

type Rgb = [number, number, number];

// Status stops (green-500 → yellow-500 → red-500 — the codebase's status hues)
const OK_RGB: Rgb = [34, 197, 94];
const WARN_RGB: Rgb = [234, 179, 8];
const CRIT_RGB: Rgb = [239, 68, 68];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [
    Math.round(lerp(a[0], b[0], t)),
    Math.round(lerp(a[1], b[1], t)),
    Math.round(lerp(a[2], b[2], t)),
  ];
}

/**
 * Data-driven fill color for a motor temperature: ok-green below 35°C,
 * blending to warning-yellow at 60°C and critical-red at 75°C+.
 *
 * @param tempC - Motor temperature in °C
 * @param alpha - Fill opacity (default 1)
 */
export function motorTempColor(tempC: number, alpha = 1): string {
  let rgb: Rgb;
  if (tempC <= MOTOR_TEMP_OK_C) {
    rgb = OK_RGB;
  } else if (tempC < MOTOR_TEMP_WARNING_C) {
    rgb = mix(OK_RGB, WARN_RGB, (tempC - MOTOR_TEMP_OK_C) / (MOTOR_TEMP_WARNING_C - MOTOR_TEMP_OK_C));
  } else if (tempC < MOTOR_TEMP_CRITICAL_C) {
    rgb = mix(WARN_RGB, CRIT_RGB, (tempC - MOTOR_TEMP_WARNING_C) / (MOTOR_TEMP_CRITICAL_C - MOTOR_TEMP_WARNING_C));
  } else {
    rgb = CRIT_RGB;
  }
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
}

/** Tailwind text class for a motor temperature value (same ≥60°C warning scale) */
export function motorTempTextClass(tempC: number): string {
  if (tempC >= MOTOR_TEMP_CRITICAL_C) return 'text-red-600 dark:text-red-400';
  if (tempC >= MOTOR_TEMP_WARNING_C) return 'text-yellow-600 dark:text-yellow-400';
  return 'text-theme-secondary';
}
