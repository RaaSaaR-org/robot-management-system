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

/** The values a fresh form starts from — and what the advanced summary compares against. */
export const NEW_SESSION_DEFAULTS = {
  type: 'vr_quest' as TeleoperationType,
  numEpisodes: 10,
  episodeTimeS: 30,
  fps: 10,
} as const;

/** The three devices the default view offers; the rest live under Advanced options. */
export const PRIMARY_INPUT_TYPES: TeleoperationType[] = ['vr_quest', 'keyboard_mouse', 'gamepad'];
export const ADVANCED_INPUT_TYPES: TeleoperationType[] = ['vr_vision_pro', 'bilateral_aloha', 'kinesthetic'];

export const RECENT_TASKS_MAX = 5;

export interface NewSessionPrefs {
  robotId?: string;
  type?: TeleoperationType;
  numEpisodes?: number;
  episodeTimeS?: number;
  fps?: number;
  /** Newest first, deduplicated, at most RECENT_TASKS_MAX. */
  recentTasks?: string[];
}

const KEY_PREFIX = 'neodem.datacollection.newSession.v1';
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
      numEpisodes: positiveInt(data.numEpisodes),
      episodeTimeS: positiveInt(data.episodeTimeS),
      fps: positiveInt(data.fps),
      recentTasks,
    };
  } catch {
    return {};
  }
}

/** Remember the values; a full or blocked store is silently ignored. */
export function saveNewSessionPrefs(userId: string | null | undefined, prefs: NewSessionPrefs): void {
  try {
    window.localStorage.setItem(prefsKey(userId), JSON.stringify(prefs));
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
