/**
 * @file index.ts
 * @description Public exports for VLA module — model management only.
 * @feature vla
 *
 * The VLA inference server is a separate Python repo (see ../vla-server/).
 * The sidecar talks to it via HTTP. This module retains only the
 * VLAModelManager for UI-facing model version tracking.
 * @status live
 */

export {
  VLAModelManager,
  type ModelSwitchRequest,
  type ModelSwitchResult,
  type ModelState,
  type ModelSwitchEvent,
  type VLAInferenceMetrics,
} from './vla-model-manager.js';

export { type VLASafetyStatus } from './types.js';
