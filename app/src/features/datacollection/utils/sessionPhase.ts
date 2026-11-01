/**
 * @file sessionPhase.ts
 * @description The session page's phase engine (TASK-425/426): the three
 *              layouts the assistant works through — Set up (created), Record
 *              (recording, paused) and Wrap up (completed, failed) — and the
 *              command bar's 2 px tally colour that tells the room the state.
 * @feature datacollection
 */

import type { TeleoperationStatus } from '../types/datacollection.types';

/** One page layout per phase. */
export type SessionPhase = 'setup' | 'record' | 'wrap';

/** `session.status` → the layout the page renders. */
export function sessionPhase(status: TeleoperationStatus): SessionPhase {
  if (status === 'created') return 'setup';
  if (status === 'recording' || status === 'paused') return 'record';
  return 'wrap';
}

/** The command bar's `data-tally`: amber getting ready, breathing red recording, quiet between, mint done. */
export type CommandBarTally = 'setup' | 'rec' | 'between' | 'fault' | 'done' | 'failed';

export interface TallyInput {
  status: TeleoperationStatus;
  /** A take is being captured (or a recorder without explicit takes is recording). */
  capturing: boolean;
  /** The robot reports a stop or a fault (E-stop latched, protective stop, error). */
  fault: boolean;
}

export function commandBarTally({ status, capturing, fault }: TallyInput): CommandBarTally {
  if (status === 'completed') return 'done';
  if (status === 'failed') return 'failed';
  if (fault) return 'fault';
  if (status === 'created') return 'setup';
  if (status === 'recording' && capturing) return 'rec';
  return 'between';
}
