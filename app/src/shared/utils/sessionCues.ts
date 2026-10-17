/**
 * @file sessionCues.ts
 * @description Short sound cues for a recording session, synthesized with
 *              WebAudio so there are no asset files to ship or license
 *              (TASK-410 D4). A take that starts rises, one that stops falls,
 *              a discard buzzes low, the auto-stop warns with a tick 3 s
 *              before it fires, and a link or robot problem sounds a double
 *              low tone. Muting is per viewer, remembered in localStorage.
 * @feature datacollection
 */

/** The cues a session plays. */
export type SessionCue = 'started' | 'stopped' | 'discarded' | 'tick' | 'problem';

/** One tone of a cue, relative to the moment the cue is played. */
export interface CueTone {
  /** Frequency in Hz */
  freq: number;
  /** Offset from the cue's start, in seconds */
  at: number;
  /** Length in seconds */
  dur: number;
  type: OscillatorType;
  /** Peak gain, 0..1 — kept low; these sit under speech */
  gain: number;
}

/** What each cue sounds like. Exported so the shapes are testable. */
export const CUE_TONES: Readonly<Record<SessionCue, readonly CueTone[]>> = {
  // Rising two-tone: something began.
  started: [
    { freq: 660, at: 0, dur: 0.09, type: 'sine', gain: 0.18 },
    { freq: 990, at: 0.11, dur: 0.12, type: 'sine', gain: 0.18 },
  ],
  // Falling two-tone: something ended.
  stopped: [
    { freq: 880, at: 0, dur: 0.09, type: 'sine', gain: 0.18 },
    { freq: 587, at: 0.11, dur: 0.14, type: 'sine', gain: 0.18 },
  ],
  // Low buzz: thrown away.
  discarded: [{ freq: 140, at: 0, dur: 0.22, type: 'sawtooth', gain: 0.08 }],
  // A short tick: the auto-stop is 3 s away.
  tick: [{ freq: 1400, at: 0, dur: 0.03, type: 'square', gain: 0.06 }],
  // Double low: the link or the robot needs a look.
  problem: [
    { freq: 220, at: 0, dur: 0.14, type: 'triangle', gain: 0.2 },
    { freq: 220, at: 0.22, dur: 0.14, type: 'triangle', gain: 0.2 },
  ],
};

/** Seconds before an auto-stop at which the warning tick plays. */
export const AUTO_STOP_WARNING_S = 3;

const MUTE_KEY = 'neodem.sessionCues.muted';

// ----------------------------------------------------------------------------
// Mute (per viewer)
// ----------------------------------------------------------------------------

let muted = readMuted();
const muteListeners = new Set<() => void>();

function readMuted(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Whether this viewer muted the session cues. */
export function isCueMuted(): boolean {
  return muted;
}

/** Mute or unmute the cues for this viewer; remembered across reloads where storage allows. */
export function setCueMuted(next: boolean): void {
  muted = next;
  try {
    if (next) localStorage.setItem(MUTE_KEY, '1');
    else localStorage.removeItem(MUTE_KEY);
  } catch {
    /* storage blocked: the choice lasts for this page only */
  }
  muteListeners.forEach((l) => l());
}

/** `useSyncExternalStore` subscription for the mute flag. */
export function subscribeCueMuted(listener: () => void): () => void {
  muteListeners.add(listener);
  return () => muteListeners.delete(listener);
}

// ----------------------------------------------------------------------------
// Playback
// ----------------------------------------------------------------------------

type AudioContextCtor = new () => AudioContext;

let context: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (context) return context;
  const g = globalThis as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  if (!Ctor) return null;
  try {
    context = new Ctor();
  } catch {
    return null;
  }
  return context;
}

/**
 * Play a cue now. Returns whether anything was scheduled: false when muted,
 * when the browser has no WebAudio, or when it refused (autoplay before the
 * first user gesture). Never throws — a cue is a nicety, not a dependency.
 */
export function playCue(cue: SessionCue): boolean {
  if (muted) return false;
  const ctx = audioContext();
  if (!ctx) return false;
  try {
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    const t0 = ctx.currentTime + 0.01;
    for (const tone of CUE_TONES[cue]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = tone.type;
      osc.frequency.setValueAtTime(tone.freq, t0 + tone.at);
      // A short attack and release, so the tone does not click.
      gain.gain.setValueAtTime(0.0001, t0 + tone.at);
      gain.gain.exponentialRampToValueAtTime(tone.gain, t0 + tone.at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + tone.at + tone.dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0 + tone.at);
      osc.stop(t0 + tone.at + tone.dur + 0.02);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Schedule the auto-stop warning tick for a take that auto-stops in
 * `secondsLeft` seconds. Plays at `secondsLeft - 3`; nothing when the warning
 * point has already passed. Returns a cancel function (call it when the take
 * stops, or the remaining time changes).
 */
export function scheduleAutoStopWarning(secondsLeft: number): () => void {
  const delayMs = (secondsLeft - AUTO_STOP_WARNING_S) * 1000;
  if (!Number.isFinite(delayMs) || delayMs < 0) return () => undefined;
  const timer = setTimeout(() => playCue('tick'), delayMs);
  return () => clearTimeout(timer);
}

/** Test hook: forget the cached AudioContext and re-read the mute flag. */
export function resetSessionCuesForTests(): void {
  context = null;
  muted = readMuted();
}
