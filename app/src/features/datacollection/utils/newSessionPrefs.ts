/**
 * @file newSessionPrefs.ts
 * @description What the New session page remembers per user (TASK-392): the
 *              last robot and input device, the advanced recording settings
 *              and the recent task instructions. Lives in localStorage, so it
 *              is a per-browser convenience — every read and write is wrapped,
 *              and a blocked or empty store just means the defaults.
 * @feature datacollection
 */

import type { TeleoperationType } from '../types/datacollection.types';

/**
 * The values a fresh form starts from — and what the advanced summary compares against.
 *
 * 30 fps is the rate LeRobot's Unitree G1 datasets are recorded at, and the
 * rate the server and the robot agent's recorder already default to when a
 * request names none. The head camera (pc2cam) delivers about 15 fps; the
 * recorder samples the sidecar's newest frame on every tick, so a slower camera
 * repeats its last picture rather than dropping rows.
 *
 * There is no episode count (TASK-406): a session records as many takes as the
 * operator wants and ends when they press End.
 */
export const NEW_SESSION_DEFAULTS = {
  type: 'vr_quest' as TeleoperationType,
  /** Per-take auto-stop in seconds; null = off, the operator ends each take (TASK-406). */
  episodeTimeS: null as number | null,
  fps: 30,
};

/** The three devices the default view offers; the rest live under Advanced options. */
export const PRIMARY_INPUT_TYPES: TeleoperationType[] = ['vr_quest', 'keyboard_mouse', 'gamepad'];
export const ADVANCED_INPUT_TYPES: TeleoperationType[] = ['vr_vision_pro', 'bilateral_aloha', 'kinesthetic'];

export const RECENT_TASKS_MAX = 5;

export interface NewSessionPrefs {
  robotId?: string;
  type?: TeleoperationType;
  /**
   * Per-take auto-stop in seconds, stored as `autoStopS`. The old
   * "Episode length" (`episodeTimeS`, which the G1 recorder never honoured) is
   * deliberately not carried over: it would silently become a real auto-stop.
   */
  episodeTimeS?: number;
  fps?: number;
  /** Newest first, deduplicated, at most RECENT_TASKS_MAX. */
  recentTasks?: string[];
}

// v2: v1 stored every value, defaults included, so a browser that used the
// form while the default was 10 fps kept recording at 10 after it became 30.
const KEY_PREFIX = 'neodem.datacollection.newSession.v2';
const ALL_TYPES: TeleoperationType[] = [...PRIMARY_INPUT_TYPES, ...ADVANCED_INPUT_TYPES];

export function prefsKey(userId: string | null | undefined): string {
  return `${KEY_PREFIX}:${userId || 'anonymous'}`;
}

const positiveInt = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : undefined;

/** Read the user's remembered values; anything malformed is dropped, never thrown. */
export function loadNewSessionPrefs(userId: string | null | undefined): NewSessionPrefs {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(prefsKey(userId));
  } catch {
    return {};
  }
  if (!raw) return {};
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (!data || typeof data !== 'object') return {};
    const type = ALL_TYPES.includes(data.type as TeleoperationType) ? (data.type as TeleoperationType) : undefined;
    const recentTasks = Array.isArray(data.recentTasks)
      ? data.recentTasks.filter((t): t is string => typeof t === 'string' && t.trim().length > 0).slice(0, RECENT_TASKS_MAX)
      : undefined;
    return {
      robotId: typeof data.robotId === 'string' && data.robotId ? data.robotId : undefined,
      type,
      // `numEpisodes` from before TASK-406 is ignored.
      episodeTimeS: positiveInt(data.autoStopS),
      fps: positiveInt(data.fps),
      recentTasks,
    };
  } catch {
    return {};
  }
}

/**
 * Remember the values; a full or blocked store is silently ignored.
 *
 * The recording numbers are kept only where they differ from the default: a
 * value the operator never changed is not a choice, and storing it would pin
 * them to today's default after the default moves.
 */
export function saveNewSessionPrefs(userId: string | null | undefined, prefs: NewSessionPrefs): void {
  const { episodeTimeS, ...rest } = prefs;
  const stored = {
    ...rest,
    autoStopS: positiveInt(episodeTimeS),
    fps: prefs.fps === NEW_SESSION_DEFAULTS.fps ? undefined : prefs.fps,
  };
  try {
    window.localStorage.setItem(prefsKey(userId), JSON.stringify(stored));
  } catch {
    /* private window or blocked storage: the page works without it */
  }
}

/** Put `task` first, drop duplicates (case- and space-insensitive), cap the list. */
export function withRecentTask(list: readonly string[] | undefined, task: string): string[] {
  const clean = task.trim();
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
  const rest = (list ?? []).filter((t) => norm(t) !== norm(clean));
  return (clean ? [clean, ...rest] : rest).slice(0, RECENT_TASKS_MAX);
}

/** Merge several sources of recent instructions into one deduplicated list. */
export function mergeRecentTasks(...lists: ReadonlyArray<readonly (string | null | undefined)[]>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const t of list) {
      if (!t || !t.trim()) continue;
      const key = t.trim().replace(/\s+/g, ' ').toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t.trim());
      if (out.length >= RECENT_TASKS_MAX) return out;
    }
  }
  return out;
}

/** `name` or `owner/name`: letters, digits, `.`, `_`, `-`; the LeRobot / Hub repo id shape. */
export const DATASET_REPO_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}(\/[A-Za-z0-9][A-Za-z0-9._-]{0,95})?$/;
