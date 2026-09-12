/**
 * @file episodeFormat.ts
 * @description Small helpers for the episode browser: clock time and score tone.
 *   Error text comes from the shared `errorMessage()` in `@/shared/components/ui`.
 * @feature training
 */

import type { StatusTagTone } from '@/shared/components/ui';

/** 75 → "1:15". */
export function formatClock(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const m = Math.floor(safe / 60);
  const s = Math.floor(safe % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Reward-model score tone: good above 0.7, doubtful above 0.4, bad below. */
export function scoreTone(score: number): StatusTagTone {
  if (score > 0.7) return 'success';
  if (score > 0.4) return 'warning';
  return 'danger';
}
