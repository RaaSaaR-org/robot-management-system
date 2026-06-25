/**
 * @file depth-sensor-config.ts
 * @description Depth / LiDAR sensor configuration management for point-cloud perception
 * @feature vla
 * @status live
 */

import type { EmbodimentConfig, DepthSensorSpec } from './types.js';

/**
 * DepthSensorManager handles depth / LiDAR sensor specifications for an
 * embodiment. It is the point-cloud analogue of {@link CameraConfigManager}:
 * cameras produce RGB images, depth sensors produce XYZ(+intensity) points.
 *
 * @example
 * ```typescript
 * const depthManager = new DepthSensorManager();
 *
 * // Get depth sensor specs for an embodiment
 * const sensors = depthManager.getDepthSensorSpecs(config);
 *
 * // Get the primary (first enabled) sensor
 * const primary = depthManager.getPrimaryDepthSensor(config);
 * ```
 */
export class DepthSensorManager {
  // Fallback frame size when a sensor omits points_per_frame
  private static readonly DEFAULT_POINTS_PER_FRAME = 20000;

  /**
   * Get all depth sensor specifications for an embodiment.
   */
  getDepthSensorSpecs(config: EmbodimentConfig): DepthSensorSpec[] {
    return config.depth_sensors ?? [];
  }

  /**
   * Get enabled depth sensors only.
   */
  getEnabledDepthSensors(config: EmbodimentConfig): DepthSensorSpec[] {
    return (config.depth_sensors ?? []).filter((s) => s.enabled !== false);
  }

  /**
   * Get a specific depth sensor by name.
   */
  getDepthSensor(name: string, config: EmbodimentConfig): DepthSensorSpec | undefined {
    return (config.depth_sensors ?? []).find((s) => s.name === name);
  }

  /**
   * Get the primary (first enabled) depth sensor — typically the LiDAR.
   */
  getPrimaryDepthSensor(config: EmbodimentConfig): DepthSensorSpec | undefined {
    return this.getEnabledDepthSensors(config)[0];
  }

  /**
   * Get the expected full-resolution point count for a sensor.
   */
  getExpectedPointCount(name: string, config: EmbodimentConfig): number {
    const sensor = this.getDepthSensor(name, config);
    return sensor?.points_per_frame ?? DepthSensorManager.DEFAULT_POINTS_PER_FRAME;
  }

  /**
   * Validate depth sensor configuration.
   *
   * @returns Validation errors (empty if valid)
   */
  validateDepthSensors(config: EmbodimentConfig): string[] {
    const errors: string[] = [];
    const sensors = config.depth_sensors ?? [];

    // Check for duplicate names
    const names = new Set<string>();
    for (const sensor of sensors) {
      if (names.has(sensor.name)) {
        errors.push(`Duplicate depth sensor name: ${sensor.name}`);
      }
      names.add(sensor.name);
    }

    // Validate each sensor
    for (const sensor of sensors) {
      if (sensor.fov_horizontal !== undefined && (sensor.fov_horizontal <= 0 || sensor.fov_horizontal > 360)) {
        errors.push(`Invalid horizontal FOV for ${sensor.name}: ${sensor.fov_horizontal}`);
      }
      if (sensor.fov_vertical !== undefined && (sensor.fov_vertical <= 0 || sensor.fov_vertical > 180)) {
        errors.push(`Invalid vertical FOV for ${sensor.name}: ${sensor.fov_vertical}`);
      }
      if (sensor.range) {
        const [min, max] = sensor.range;
        if (min < 0 || max <= min) {
          errors.push(`Invalid range for ${sensor.name}: [${min}, ${max}]`);
        }
      }
    }

    return errors;
  }

  /**
   * Get depth sensor info string for logging.
   */
  getDepthSensorInfo(config: EmbodimentConfig): string {
    const sensors = this.getEnabledDepthSensors(config);
    if (sensors.length === 0) {
      return 'No depth sensors configured';
    }

    return sensors
      .map((s) => {
        const fov = s.fov_horizontal ? ` (${s.fov_horizontal}°×${s.fov_vertical ?? '?'}°)` : '';
        return `${s.name} [${s.type}]${fov}`;
      })
      .join(', ');
  }
}
