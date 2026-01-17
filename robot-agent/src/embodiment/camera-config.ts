/**
 * @file camera-config.ts
 * @description Camera configuration management for VLA observations
 * @feature vla
 */

import type { EmbodimentConfig, CameraSpec, Resolution } from './types.js';

/**
 * CameraConfigManager handles camera specifications and image
 * preprocessing for VLA observations.
 *
 * @example
 * ```typescript
 * const cameraManager = new CameraConfigManager();
 *
 * // Get camera specs for an embodiment
 * const cameras = cameraManager.getCameraSpecs(config);
 *
 * // Get expected resolution for a camera
 * const [width, height] = cameraManager.getExpectedResolution('head_camera', config);
 *
 * // Preprocess image for VLA model
 * const processed = cameraManager.preprocessImage(rawImage, 'head_camera', config);
 * ```
 */
export class CameraConfigManager {
  // Default resolution if not specified
  private static readonly DEFAULT_RESOLUTION: Resolution = [224, 224];

  // Default normalization values (ImageNet)
  private static readonly IMAGENET_MEAN = [0.485, 0.456, 0.406];
  private static readonly IMAGENET_STD = [0.229, 0.224, 0.225];

  /**
   * Get all camera specifications for an embodiment.
   *
   * @param config Embodiment configuration
   * @returns Array of camera specifications
   */
  getCameraSpecs(config: EmbodimentConfig): CameraSpec[] {
    return config.cameras ?? [];
  }

  /**
   * Get enabled cameras only.
   *
   * @param config Embodiment configuration
   * @returns Array of enabled camera specifications
   */
  getEnabledCameras(config: EmbodimentConfig): CameraSpec[] {
    return (config.cameras ?? []).filter(cam => cam.enabled !== false);
  }

  /**
   * Get a specific camera by name.
   *
   * @param cameraName Camera identifier
   * @param config Embodiment configuration
   * @returns Camera specification or undefined
   */
  getCamera(cameraName: string, config: EmbodimentConfig): CameraSpec | undefined {
    return (config.cameras ?? []).find(cam => cam.name === cameraName);
  }

  /**
   * Get the expected resolution for a camera.
   *
   * @param cameraName Camera identifier
   * @param config Embodiment configuration
   * @returns Resolution tuple [width, height]
   */
  getExpectedResolution(cameraName: string, config: EmbodimentConfig): Resolution {
    const camera = this.getCamera(cameraName, config);
    if (camera?.resolution) {
      return camera.resolution;
    }
    return CameraConfigManager.DEFAULT_RESOLUTION;
  }

  /**
   * Get the primary (first enabled) camera.
   *
   * @param config Embodiment configuration
   * @returns Primary camera or undefined
   */
  getPrimaryCamera(config: EmbodimentConfig): CameraSpec | undefined {
    return this.getEnabledCameras(config)[0];
  }

  /**
   * Preprocess an image for VLA model input.
   * Handles resizing and pixel normalization.
   *
   * Note: Actual image processing requires canvas/sharp libraries.
   * This implementation provides the preprocessing pipeline structure.
   *
   * @param image Raw image buffer (RGB)
   * @param cameraName Camera identifier
   * @param config Embodiment configuration
   * @returns Preprocessed image buffer
   */
  preprocessImage(
    image: Buffer,
    cameraName: string,
    config: EmbodimentConfig
  ): Buffer {
    const [targetWidth, targetHeight] = this.getExpectedResolution(cameraName, config);

    // Check if image needs resizing (simplified check based on buffer size)
    const expectedSize = targetWidth * targetHeight * 3; // RGB

    if (image.length !== expectedSize) {
      // In a real implementation, use sharp or canvas to resize
      console.warn(
        `[CameraConfigManager] Image size mismatch: expected ${expectedSize} bytes ` +
        `(${targetWidth}x${targetHeight}x3), got ${image.length}. ` +
        `Resize required but not implemented in simulation.`
      );

      // Return padded/truncated buffer for simulation
      if (image.length < expectedSize) {
        const padded = Buffer.alloc(expectedSize);
        image.copy(padded);
        return padded;
      } else {
        return image.subarray(0, expectedSize);
      }
    }

    return image;
  }

  /**
   * Normalize pixel values from [0, 255] to [0, 1] range.
   *
   * @param image Raw image buffer (RGB, uint8)
   * @returns Float32Array with values in [0, 1]
   */
  normalizePixels(image: Buffer): Float32Array {
    const normalized = new Float32Array(image.length);
    for (let i = 0; i < image.length; i++) {
      normalized[i] = image[i] / 255.0;
    }
    return normalized;
  }

  /**
   * Apply ImageNet normalization (mean subtraction and std division).
   *
   * @param image Normalized image buffer (RGB, float32 in [0, 1])
   * @param width Image width
   * @param height Image height
   * @returns ImageNet-normalized Float32Array
   */
  applyImageNetNormalization(
    image: Float32Array,
    width: number,
    height: number
  ): Float32Array {
    const result = new Float32Array(image.length);
    const pixelCount = width * height;

    for (let p = 0; p < pixelCount; p++) {
      for (let c = 0; c < 3; c++) {
        const idx = p * 3 + c;
        result[idx] = (image[idx] - CameraConfigManager.IMAGENET_MEAN[c]) /
                       CameraConfigManager.IMAGENET_STD[c];
      }
    }

    return result;
  }

  /**
   * Full preprocessing pipeline: resize, normalize to [0,1], apply ImageNet norm.
   *
   * @param image Raw image buffer (RGB)
   * @param cameraName Camera identifier
   * @param config Embodiment configuration
   * @returns Preprocessed Float32Array ready for VLA model
   */
  preprocessForModel(
    image: Buffer,
    cameraName: string,
    config: EmbodimentConfig
  ): Float32Array {
    // Step 1: Resize to expected resolution
    const resized = this.preprocessImage(image, cameraName, config);

    // Step 2: Normalize to [0, 1]
    const normalized = this.normalizePixels(resized);

    // Step 3: Apply ImageNet normalization
    const [width, height] = this.getExpectedResolution(cameraName, config);
    return this.applyImageNetNormalization(normalized, width, height);
  }

  /**
   * Create a placeholder image buffer for simulation.
   *
   * @param cameraName Camera identifier
   * @param config Embodiment configuration
   * @param fill Fill value (0-255)
   * @returns Placeholder image buffer
   */
  createPlaceholderImage(
    cameraName: string,
    config: EmbodimentConfig,
    fill: number = 128
  ): Buffer {
    const [width, height] = this.getExpectedResolution(cameraName, config);
    const size = width * height * 3;
    const buffer = Buffer.alloc(size, fill);
    return buffer;
  }

  /**
   * Validate camera configuration.
   *
   * @param config Embodiment configuration
   * @returns Validation errors (empty if valid)
   */
  validateCameras(config: EmbodimentConfig): string[] {
    const errors: string[] = [];
    const cameras = config.cameras ?? [];

    // Check for duplicate names
    const names = new Set<string>();
    for (const camera of cameras) {
      if (names.has(camera.name)) {
        errors.push(`Duplicate camera name: ${camera.name}`);
      }
      names.add(camera.name);
    }

    // Validate each camera
    for (const camera of cameras) {
      const [width, height] = camera.resolution;

      if (width <= 0 || height <= 0) {
        errors.push(`Invalid resolution for ${camera.name}: ${width}x${height}`);
      }

      if (camera.fov !== undefined && (camera.fov <= 0 || camera.fov > 180)) {
        errors.push(`Invalid FOV for ${camera.name}: ${camera.fov}`);
      }
    }

    return errors;
  }

  /**
   * Get camera info string for logging.
   *
   * @param config Embodiment configuration
   * @returns Human-readable camera info
   */
  getCameraInfo(config: EmbodimentConfig): string {
    const cameras = this.getEnabledCameras(config);
    if (cameras.length === 0) {
      return 'No cameras configured';
    }

    return cameras.map(cam => {
      const [w, h] = cam.resolution;
      return `${cam.name}: ${w}x${h}${cam.fov ? ` (FOV: ${cam.fov}°)` : ''}`;
    }).join(', ');
  }
}
