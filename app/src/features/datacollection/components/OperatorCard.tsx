/**
 * @file OperatorCard.tsx
 * @description What the desktop knows about the operator in the headset
 *              (TASK-414), as data for the Record console's operator chip
 *              (TASK-428): the status line ("In VR · link live 38 ms"), the
 *              link's latency and its colour, and each hand's grip. The old
 *              card is gone: the chip on the live view shows the latency and
 *              the grips, the Arms cell the why line, the dock's blocker what
 *              the robot held, and the Quest buttons live in the Headset cell.
 * @feature datacollection
 */

import type { OperatorState } from '../types/datacollection.types';

/** The operator's link in one colour: live mint, stale amber, lost red. */
export const LINK_CLASS: Record<OperatorState['link'], string> = {
  live: 'text-signal-measured',
  stale: 'text-signal-unknown',
  lost: 'text-signal-stopped',
};

/** The why line's colour: block red, warn amber, ok quiet. */
export const WHY_CLASS: Record<OperatorState['why']['severity'], string> = {
  block: 'text-signal-stopped',
  warn: 'text-signal-unknown',
  ok: 'text-ink-secondary',
};

/** "In VR · link live 38 ms" / "Headset open, not in VR". */
export function operatorStatusLine(op: OperatorState): string {
  if (!op.inVr) return 'Headset open, not in VR';
  const rtt = op.rttMs === null ? '' : ` ${Math.round(op.rttMs)} ms`;
  return `In VR · link ${op.link}${rtt}`;
}

/** The chip's latency text: "38 ms", or the link state when no round trip is known. */
export function operatorLatency(op: OperatorState): string {
  if (op.link === 'lost') return 'Link lost';
  return op.rttMs === null ? `Link ${op.link}` : `${Math.round(op.rttMs)} ms`;
}

/** A grip axis (0..1) as a whole percent. */
export function gripPercent(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 100);
}

/** What the robot held, as one line: "held: arm_gate (right)". */
export function heldLine(held: NonNullable<OperatorState['held']>): string {
  return `held: ${held.reason}${held.side !== 'both' ? ` (${held.side})` : ''}`;
}
