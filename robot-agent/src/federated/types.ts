/**
 * @file types.ts
 * @description Type definitions for the federated learning module
 * @feature Federated Learning
 * @status live-conditional
 */

/** LoRA fine-tuning configuration */
export interface LoRAConfig {
  /** LoRA rank (decomposition dimension) */
  rank: number;
  /** LoRA alpha scaling factor */
  alpha: number;
  /** Target module names for LoRA adaptation */
  targetModules: string[];
  /** Number of training epochs */
  epochs: number;
  /** Learning rate for the optimizer */
  learningRate: number;
}

/** Result from a local training run */
export interface TrainingResult {
  /** Gradient matrices produced by training */
  gradients: number[][];
  /** Final training loss */
  loss: number;
  /** Total training steps completed */
  steps: number;
  /** Training duration in milliseconds */
  duration_ms: number;
}

/** A single training episode (observation + action sequence) */
export interface TrainingEpisode {
  /** Unique episode identifier */
  id: string;
  /** Task instruction for this episode */
  instruction: string;
  /** Sequence of observation frames (e.g., image paths or base64) */
  observations: string[];
  /** Sequence of action vectors */
  actions: number[][];
  /** Optional reward signal */
  reward?: number;
  /** ISO timestamp of episode recording */
  timestamp: string;
}

/** Federated learning round metadata from the server */
export interface FederatedRound {
  /** Unique round identifier */
  id: string;
  /** Round number in the FL process */
  roundNumber: number;
  /** Current round status */
  status: 'open' | 'training' | 'aggregating' | 'completed' | 'failed';
  /** LoRA configuration for this round */
  loraConfig: LoRAConfig;
  /** Minimum number of participants required */
  minParticipants: number;
  /** Current participant count */
  currentParticipants: number;
  /** Differential privacy configuration */
  dpConfig: DPConfig;
  /** ISO timestamp when the round was created */
  createdAt: string;
  /** ISO timestamp deadline for gradient uploads */
  deadline?: string;
}

/** Differential privacy configuration for a round */
export interface DPConfig {
  /** Maximum L2-norm for gradient clipping */
  maxNorm: number;
  /** Privacy budget ε */
  epsilon: number;
  /** Privacy parameter δ */
  delta: number;
}

/** Status response for the federated learning subsystem */
export interface FederatedStatus {
  /** Whether federated learning is enabled */
  enabled: boolean;
  /** Whether the lifecycle is currently running */
  running: boolean;
  /** Current round being participated in, if any */
  currentRoundId: string | null;
  /** Current phase of the local round */
  phase: 'idle' | 'waiting' | 'training' | 'uploading' | 'downloading' | 'error';
  /** Last error message, if any */
  lastError: string | null;
  /** Total rounds participated in */
  roundsParticipated: number;
  /** ISO timestamp of the last participation */
  lastParticipation: string | null;
}

/** Events emitted by the RoundLifecycle */
export type FederatedEventType =
  | 'round-started'
  | 'training-complete'
  | 'gradients-uploaded'
  | 'model-updated'
  | 'round-error';

/** Payload for federated lifecycle events */
export interface FederatedEvent {
  type: FederatedEventType;
  roundId: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

/** Listener for federated lifecycle events */
export type FederatedEventListener = (event: FederatedEvent) => void;
