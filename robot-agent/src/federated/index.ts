/**
 * @file index.ts
 * @description Barrel exports for the federated learning module
 * @feature Federated Learning
 */

export { DifferentialPrivacy } from './DifferentialPrivacy.js';
export { FederatedClient } from './FederatedClient.js';
export type { JoinRoundResponse, UploadGradientsResponse, DownloadModelResponse } from './FederatedClient.js';
export { LocalTrainer } from './LocalTrainer.js';
export { RoundLifecycle } from './RoundLifecycle.js';
export type { RoundLifecycleConfig } from './RoundLifecycle.js';

export type {
  LoRAConfig,
  TrainingResult,
  TrainingEpisode,
  FederatedRound,
  DPConfig,
  FederatedStatus,
  FederatedEvent,
  FederatedEventType,
  FederatedEventListener,
} from './types.js';
