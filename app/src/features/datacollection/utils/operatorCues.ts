/**
 * @file operatorCues.ts
 * @description Which sound cues the desktop assistant hears about the
 *              operator (TASK-414): a soft chime when they enter VR, the double
 *              low tone when their why line blocks for more than a second while
 *              a take is capturing ("the arms stopped following during a
 *              take"), and a tone when the headset's link is lost. Pure — the
 *              hook feeds it the latest state and a clock.
 * @feature datacollection
 */

import type { SessionCue } from '@/shared/utils/sessionCues';
import type { OperatorState } from '../types/datacollection.types';

/** A block shorter than this during a take is a blip, not a stop. */
export const BLOCK_CUE_AFTER_MS = 1_000;

export interface OperatorCueMemory {
  inVr: boolean;
  link: OperatorState['link'] | null;
  /** When the current block during a take began; null when none. */
  blockSince: number | null;
  /** The current block has already sounded. */
  blockCued: boolean;
}

export const INITIAL_OPERATOR_CUE_MEMORY: OperatorCueMemory = { inVr: false, link: null, blockSince: null, blockCued: false };

/**
 * The cues for one look at the operator. `operator` is the fresh state or
 * null (no operator, or gone stale); `capturing` is whether a take records.
 */
export function operatorCues(
  memory: OperatorCueMemory,
  operator: OperatorState | null,
  capturing: boolean,
  now: number,
): { cues: SessionCue[]; memory: OperatorCueMemory } {
  const cues: SessionCue[] = [];
  const inVr = !!operator?.inVr;
  if (inVr && !memory.inVr) cues.push('joined');

  const link = operator ? operator.link : null;
  if (link === 'lost' && memory.link !== null && memory.link !== 'lost') cues.push('linkLost');

  let blockSince = memory.blockSince;
  let blockCued = memory.blockCued;
  if (operator && inVr && capturing && operator.why.severity === 'block') {
    blockSince ??= now;
    if (!blockCued && now - blockSince > BLOCK_CUE_AFTER_MS) {
      cues.push('problem');
      blockCued = true;
    }
  } else {
    blockSince = null;
    blockCued = false;
  }
  return { cues, memory: { inVr, link, blockSince, blockCued } };
}
