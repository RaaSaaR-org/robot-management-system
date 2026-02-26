/**
 * @file index.ts
 * @description Public exports for VLA module — model management only.
 * @feature vla
 *
 * The VLA inference server is now a separate Python service (vla-server/).
 * The sidecar talks to it via HTTP. This module retains only the
 * VLAModelManager for UI-facing model version tracking.
 */

export {
  VLAModelManager,
  type ModelSwitchRequest,
  type ModelSwitchResult,
  type ModelState,
  type ModelSwitchEvent,
  type VLAInferenceMetrics,
} from './vla-model-manager.js';
