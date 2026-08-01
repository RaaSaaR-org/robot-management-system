/**
 * @file voiceStore.ts
 * @description Zustand store for the robot voice mode: conversation history
 *              (typed / heard / replies), live pipeline state and sidecar
 *              health, fed by the server-relayed SSE event stream. History is
 *              session-only (never persisted) and capped per robot.
 * @feature robots
 */

import { createStore } from '@/store';
import type {
  VoiceConnectionState,
  VoiceEvent,
  VoiceHealth,
  VoiceHistoryEntry,
  VoiceMicActivity,
  VoicePipelineState,
  VoiceStatus,
} from '../types/voice.types';

// ============================================================================
// CONSTANTS
// ============================================================================

const MAX_ENTRIES = 200;
const MAX_MIC_ACTIVITY = 30;

// ============================================================================
// TYPES
// ============================================================================

export interface VoiceRobotState {
  pipelineState: VoicePipelineState;
  paused: boolean;
  entries: VoiceHistoryEntry[];
  micActivity: VoiceMicActivity[];
  /** Timestamp (epoch s) of the newest applied SSE event — dedups the replay
   *  of recent events the voice service sends on every (re)connect. */
  lastEventTs: number;
  /** Set when the service reports the mic loop can't run (missing components) */
  micLoopDisabled: string | null;
}

export interface VoiceStore {
  byRobot: Record<string, VoiceRobotState>;
  connection: Record<string, VoiceConnectionState>;
  health: Record<string, VoiceHealth | null>;
  status: Record<string, VoiceStatus | null>;

  applyEvent: (robotId: string, event: VoiceEvent) => void;
  addTypedEntry: (robotId: string, text: string, language?: string) => void;
  setConnection: (robotId: string, state: VoiceConnectionState) => void;
  setHealth: (robotId: string, health: VoiceHealth | null) => void;
  setStatus: (robotId: string, status: VoiceStatus | null) => void;
  setPaused: (robotId: string, paused: boolean) => void;
  clearHistory: (robotId: string) => void;
}

// ============================================================================
// HELPERS
// ============================================================================

export function emptyVoiceRobotState(): VoiceRobotState {
  return {
    pipelineState: 'unknown',
    paused: false,
    entries: [],
    micActivity: [],
    lastEventTs: 0,
    micLoopDisabled: null,
  };
}

let entrySeq = 0;
function nextEntryId(ts: number): string {
  entrySeq += 1;
  return `${ts}-${entrySeq}`;
}

function pushEntry(state: VoiceRobotState, entry: VoiceHistoryEntry): void {
  state.entries.push(entry);
  if (state.entries.length > MAX_ENTRIES) {
    state.entries.splice(0, state.entries.length - MAX_ENTRIES);
  }
}

function pushMicActivity(state: VoiceRobotState, label: string, ts: number): void {
  state.micActivity.push({ id: nextEntryId(ts), label, ts });
  if (state.micActivity.length > MAX_MIC_ACTIVITY) {
    state.micActivity.splice(0, state.micActivity.length - MAX_MIC_ACTIVITY);
  }
}

/**
 * Apply one SSE pipeline event to a robot's voice state. Pure mutation on the
 * (immer-drafted) state — exported for unit tests.
 */
export function applyVoiceEvent(state: VoiceRobotState, event: VoiceEvent): void {
  // The service replays its last few events on every SSE (re)connect; skip
  // anything we already applied. ts has millisecond resolution.
  if (typeof event.ts !== 'number' || event.ts <= state.lastEventTs) return;
  state.lastEventTs = event.ts;
  const tsMs = Math.round(event.ts * 1000);

  switch (event.type) {
    case 'state':
      state.pipelineState = (event.state as VoicePipelineState) ?? 'unknown';
      if (state.pipelineState === 'paused') state.paused = true;
      break;
    case 'transcript':
      pushEntry(state, {
        id: nextEntryId(tsMs),
        kind: 'heard',
        text: String(event.text ?? ''),
        language: typeof event.language === 'string' ? event.language : undefined,
        ts: tsMs,
      });
      break;
    case 'reply':
      pushEntry(state, {
        id: nextEntryId(tsMs),
        kind: 'reply',
        text: String(event.text ?? ''),
        ts: tsMs,
      });
      break;
    case 'error':
      pushEntry(state, {
        id: nextEntryId(tsMs),
        kind: 'error',
        text: `${String(event.stage ?? 'pipeline')}: ${String(event.error ?? 'unknown error')}`,
        ts: tsMs,
      });
      break;
    case 'session_reset':
      pushEntry(state, {
        id: nextEntryId(tsMs),
        kind: 'reset',
        text: String(event.source ?? ''),
        ts: tsMs,
      });
      break;
    case 'listen_toggled':
      state.paused = Boolean(event.paused);
      break;
    case 'listen_loop_disabled':
      state.micLoopDisabled = Array.isArray(event.missing)
        ? event.missing.join(', ')
        : String(event.missing ?? 'unknown');
      break;
    case 'transcript_discarded':
      pushMicActivity(state, `Transcript discarded (${String(event.reason ?? '?')})`, tsMs);
      break;
    case 'wake_ignored':
      pushMicActivity(state, `Ignored (no wake phrase): "${String(event.text ?? '')}"`, tsMs);
      break;
    case 'thinking_filler':
      pushMicActivity(state, 'Spoke a thinking filler', tsMs);
      break;
    case 'tts_start':
      pushMicActivity(
        state,
        `Speaking (${String(event.chars ?? '?')} chars, ${String(event.language ?? '?')})`,
        tsMs
      );
      break;
    case 'speak_skipped':
      pushMicActivity(state, 'Speak skipped (no TTS/output wired)', tsMs);
      break;
    default:
      // tts_end, config_changed, service_started, *_loaded, agent_skipped, …
      // carry no conversation payload — state/health polling covers them.
      break;
  }
}

// ============================================================================
// STORE
// ============================================================================

export const useVoiceStore = createStore<VoiceStore>(
  (set) => ({
    byRobot: {},
    connection: {},
    health: {},
    status: {},

    applyEvent: (robotId, event) =>
      set((state) => {
        state.byRobot[robotId] ??= emptyVoiceRobotState();
        applyVoiceEvent(state.byRobot[robotId], event);
      }),

    addTypedEntry: (robotId, text, language) =>
      set((state) => {
        state.byRobot[robotId] ??= emptyVoiceRobotState();
        pushEntry(state.byRobot[robotId], {
          id: nextEntryId(Date.now()),
          kind: 'typed',
          text,
          language,
          ts: Date.now(),
        });
      }),

    setConnection: (robotId, connectionState) =>
      set((state) => {
        state.connection[robotId] = connectionState;
      }),

    setHealth: (robotId, health) =>
      set((state) => {
        state.health[robotId] = health;
        const paused = health?.service?.paused;
        if (paused !== undefined) {
          state.byRobot[robotId] ??= emptyVoiceRobotState();
          state.byRobot[robotId].paused = paused;
        }
      }),

    setStatus: (robotId, status) =>
      set((state) => {
        state.status[robotId] = status;
        // The pipeline state otherwise only ever arrives on the SSE stream, so
        // a page opened onto a quiet service showed "Unknown" until somebody
        // spoke — while /status was plainly answering "idle" all along. Adopted
        // only until the first live event: after that the stream is fresher
        // than a 10-second poll, and folding the poll in would flip a live
        // "Speaking" back to "Idle" mid-sentence.
        if (status && state.byRobot[robotId]?.lastEventTs) return;
        if (status) {
          state.byRobot[robotId] ??= emptyVoiceRobotState();
          state.byRobot[robotId].pipelineState = status.state;
        }
      }),

    setPaused: (robotId, paused) =>
      set((state) => {
        state.byRobot[robotId] ??= emptyVoiceRobotState();
        state.byRobot[robotId].paused = paused;
      }),

    clearHistory: (robotId) =>
      set((state) => {
        if (state.byRobot[robotId]) {
          state.byRobot[robotId].entries = [];
          state.byRobot[robotId].micActivity = [];
        }
      }),
  }),
  { name: 'VoiceStore' }
);
