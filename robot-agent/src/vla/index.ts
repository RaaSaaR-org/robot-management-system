/**
 * @file index.ts
 * @description Public exports for VLA gRPC client module
 * @feature vla
 */

// Core VLA client
export { VLAClient } from './vla-client.js';
export { VLAMetrics } from './metrics.js';

// Action buffer and interpolation (Task 46)
export { ActionBuffer } from './action-buffer.js';
export { ActionInterpolator, type InterpolatorConfig } from './action-interpolator.js';
export {
  VLAController,
  type ActionExecutor,
  type ObservationGenerator,
} from './vla-controller.js';

// Model management (Task 47)
export {
  VLAModelManager,
  type ModelSwitchRequest,
  type ModelSwitchResult,
  type ModelState,
  type ModelSwitchEvent,
  type VLAInferenceMetrics,
} from './vla-model-manager.js';

// Types
export type {
  // Core VLA types
  Observation,
  Action,
  ActionChunk,
  ModelInfo,
  HealthStatus,
  VLAClientConfig,
  ConnectionState,
  VLAClientEvent,
  LatencyMetrics,
  InferenceMetrics,
  // Controller types (Task 46)
  BufferLevel,
  VLAControllerMode,
  InterpolationMethod,
  ActionBufferConfig,
  VLAControllerConfig,
  VLAStatus,
  ActionResult,
  ActionBufferEvent,
  VLAControllerEvent,
} from './types.js';
