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

/** What the text is. Separate from the voice pack that speaks it. */
export type VoiceLanguage = 'de' | 'en';

/**
 * One selectable voice (voice service tts/registry.py), relayed by the server
 * from the robot so the frontend never hardcodes the list. `commercial` and
 * `realtime` are the two caveats a customer must see before relying on a pack.
 */
export interface VoicePack {
  id: string;
  label: string;
  engine: string;
  /** Languages the voice is meant for — metadata, not a filter */
  languages: string[];
  licence: string;
  /** May a customer ship this voice? False for GPL/NC-encumbered packs */
  commercial: boolean;
  /** Fast enough for a conversational turn */
  realtime: boolean;
  /** Loaded on the robot; when false, `reason` says why */
  available: boolean;
  reason: string | null;
}

/** GET /voice/voices — the robot's packs and the one it speaks in by default. */
export interface VoicePackListing {
  active: string;
  available: boolean;
  reason: string | null;
  voices: VoicePack[];
}

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
    /** The active voice pack and the full pack list (absent on older services) */
    voice?: VoicePackListing;
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
