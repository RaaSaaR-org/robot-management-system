/**
 * @file voice.types.ts
 * @description Types for the robot voice mode (say / live transcripts / pipeline state).
 *              Mirrors the voice service HTTP API (:8768) relayed through the server.
 * @feature robots
 */

/** Half-duplex pipeline states reported by the voice service. */
export type VoicePipelineState =
  | 'idle'
  | 'listening'
  | 'capturing'
  | 'thinking'
  | 'speaking'
  | 'paused'
  | 'unknown';

export type VoiceLanguage = 'de' | 'en';

/** GET /voice/health — aggregated availability of the voice sidecars. */
export interface VoiceHealth {
  /** Voice service reachable (the frontend's degradation signal) */
  available: boolean;
  service: {
    status: string;
    state: VoicePipelineState;
    paused: boolean;
    models_loaded: { stt?: boolean; tts?: boolean };
    components: {
      audio_in: boolean;
      audio_out: boolean;
      stt: boolean;
      tts: boolean;
      a2a: boolean;
    };
    agent_reachable: boolean | null;
  } | null;
  /** G1 audio adapter (speaker volume); null when unreachable */
  adapter: { status: string; mock: boolean } | null;
}

/** GET /voice/status — pipeline session + latency metrics. */
export interface VoiceStatus {
  state: VoicePipelineState;
  paused: boolean;
  wake: { enabled: boolean; windowOpenS: number | null };
  contextId: string | null;
  lastTranscript: string | null;
  lastReply: string | null;
  metrics: Record<string, { p50?: number; p95?: number; count?: number }>;
}

/**
 * One SSE event from the voice pipeline. `ts` is epoch seconds; remaining
 * fields depend on `type` (state / transcript / reply / error / ...).
 */
export interface VoiceEvent {
  type: string;
  ts: number;
  [key: string]: unknown;
}

/** Kinds of entries in the voice conversation feed. */
export type VoiceEntryKind = 'typed' | 'heard' | 'reply' | 'error' | 'reset';

/** One row in the voice conversation history. */
export interface VoiceHistoryEntry {
  id: string;
  kind: VoiceEntryKind;
  text: string;
  language?: string;
  /** Epoch milliseconds */
  ts: number;
}

/** Low-level mic/pipeline activity shown in the side panel (not conversation). */
export interface VoiceMicActivity {
  id: string;
  label: string;
  /** Epoch milliseconds */
  ts: number;
}

/** SSE relay connection state (server → browser). */
export type VoiceConnectionState = 'connecting' | 'open' | 'error';
