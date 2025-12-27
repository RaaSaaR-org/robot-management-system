/**
 * @file index.ts
 * @description Barrel exports for service interfaces
 * @feature core
 */

export type { IRobotManager, RobotEventCallback } from './IRobotManager.js';
export type {
  IConversationManager,
  TaskEventCallback,
  ProcessMessageResult,
} from './IConversationManager.js';
export type { IProcessManager, ProcessEventHandler } from './IProcessManager.js';
