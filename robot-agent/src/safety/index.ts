/**
 * @file index.ts
 * @description Safety module exports
 * @feature safety
 * @status live
 */

export * from './types.js';
export {
  SafetyMonitor,
  type SafetyEventCallback,
  type StopActuation,
  type StopActuator,
} from './SafetyMonitor.js';
